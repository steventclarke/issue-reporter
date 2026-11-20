import * as cdk from 'aws-cdk-lib';
import { Tags } from 'aws-cdk-lib';
import { Alarm, ComparisonOperator, TreatMissingData } from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import {
  AllowedMethods,
  CachePolicy,
  CachedMethods,
  Distribution,
  FunctionUrlOriginAccessControl,
  HeadersFrameOption,
  HeadersReferrerPolicy,
  OriginRequestPolicy,
  PriceClass,
  ResponseHeadersPolicy,
  SecurityPolicyProtocol,
  SSLMethod,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { FunctionUrlOrigin, S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { AttributeType, BillingMode, Table, TableEncryption } from 'aws-cdk-lib/aws-dynamodb';
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Architecture, FunctionUrlAuthType, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { ARecord, AaaaRecord, HostedZone, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NagSuppressions } from 'cdk-nag';
import { join } from 'node:path';
import { allowedOrigins, applications } from '../config/applications';

export type IssueIntakeEnvironment = 'preview' | 'prod';

export interface IssueIntakeStackProps extends cdk.StackProps {
  environmentName: IssueIntakeEnvironment;
}

export class IssueIntakeStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props: IssueIntakeStackProps) {
    super(scope, id, props);

    Tags.of(this).add('project', 'issue-reporter');
    Tags.of(this).add('environment', props.environmentName);
    Tags.of(this).add('owner', 'stevenclarke');
    Tags.of(this).add('application', 'issue-intake');
    Tags.of(this).add('managed-by', 'cdk');

    const hostedZoneId = StringParameter.valueForStringParameter(
      this,
      '/platform/dns/hosted-zone-id',
    );
    const domainName = StringParameter.valueForStringParameter(this, '/platform/dns/domain-name');
    const certificateArn = StringParameter.valueForStringParameter(
      this,
      '/platform/certs/us-east-1/wildcard-arn',
    );
    const alertsTopicArn = StringParameter.valueForStringParameter(
      this,
      '/platform/monitoring/alerts-topic-arn',
    );

    const hostedZone = HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
      hostedZoneId,
      zoneName: domainName,
    });
    const certificate = cdk.aws_certificatemanager.Certificate.fromCertificateArn(
      this,
      'WildcardCertificate',
      certificateArn,
    );
    const alertsTopic = Topic.fromTopicArn(this, 'AlertsTopic', alertsTopicArn);

    const fqdn = `issues.${domainName}`;
    const apiUrl = `https://${fqdn}`;

    const enabledApplications = applications.filter((app) => app.issueIntake?.enabled);
    const appConfig = Object.fromEntries(
      enabledApplications.map((app) => [app.name, app.issueIntake]),
    );
    const appOrigins = Object.fromEntries(
      enabledApplications.map((app) => [app.name, allowedOrigins]),
    );

    new StringParameter(this, 'ApiUrlParameter', {
      parameterName: '/platform/issue-intake/api-url',
      stringValue: apiUrl,
      description: 'Public issue intake API URL',
    });
    for (const app of enabledApplications) {
      const path = `/platform/issue-intake/apps/${app.name}`;
      new StringParameter(this, `${app.name}AppIdParameter`, {
        parameterName: `${path}/app-id`,
        stringValue: app.name,
        description: `${app.name} issue intake application id`,
      });
      new StringParameter(this, `${app.name}RepoParameter`, {
        parameterName: `${path}/repo`,
        stringValue: app.repo,
        description: `${app.name} GitHub repository`,
      });
      new StringParameter(this, `${app.name}LabelsParameter`, {
        parameterName: `${path}/labels`,
        stringValue: JSON.stringify(app.issueIntake?.labels ?? []),
        description: `${app.name} GitHub issue labels`,
      });
    }

    const reportsTable = new Table(this, 'ReportsTable', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      sortKey: { name: 'sk', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const attachmentsBucket = new Bucket(this, 'AttachmentsBucket', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          id: 'expire-closed-attachments',
          enabled: true,
          tagFilters: { 'closure-marker': 'true' },
          expiration: cdk.Duration.days(30),
        },
        {
          id: 'abort-incomplete-multipart-uploads',
          enabled: true,
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
        },
      ],
    });

    const workerDlq = new Queue(this, 'WorkerDlq', {
      retentionPeriod: cdk.Duration.days(14),
      encryption: QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
    });
    const workerQueue = new Queue(this, 'WorkerQueue', {
      visibilityTimeout: cdk.Duration.seconds(180),
      retentionPeriod: cdk.Duration.days(4),
      encryption: QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      deadLetterQueue: { queue: workerDlq, maxReceiveCount: 5 },
    });

    const githubAppSecret = Secret.fromSecretNameV2(
      this,
      'GitHubAppSecret',
      '/platform/issue-intake/github-app',
    );

    const ingestFunction = new NodejsFunction(this, 'IngestFunction', {
      entry: join(__dirname, '../src/ingest/index.ts'),
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      memorySize: 512,
      timeout: cdk.Duration.seconds(10),
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node22',
      },
      environment: {
        REPORTS_TABLE_NAME: reportsTable.tableName,
        ATTACHMENTS_BUCKET_NAME: attachmentsBucket.bucketName,
        WORKER_QUEUE_URL: workerQueue.queueUrl,
        APP_CONFIG: JSON.stringify(appConfig),
        ALLOWED_ORIGINS: JSON.stringify(appOrigins),
      },
    });
    reportsTable.grantReadWriteData(ingestFunction);
    attachmentsBucket.grantReadWrite(ingestFunction);
    workerQueue.grantSendMessages(ingestFunction);

    const ingestFunctionUrl = ingestFunction.addFunctionUrl({
      authType: FunctionUrlAuthType.AWS_IAM,
    });

    const workerFunction = new NodejsFunction(this, 'WorkerFunction', {
      entry: join(__dirname, '../src/worker/index.ts'),
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node22',
      },
      environment: {
        REPORTS_TABLE_NAME: reportsTable.tableName,
        ATTACHMENTS_BUCKET_NAME: attachmentsBucket.bucketName,
        GITHUB_APP_SECRET_ID: githubAppSecret.secretArn,
        ATTACHMENTS_BASE_URL: apiUrl,
      },
    });
    reportsTable.grantReadWriteData(workerFunction);
    attachmentsBucket.grantRead(workerFunction);
    githubAppSecret.grantRead(workerFunction);
    workerFunction.addEventSource(
      new SqsEventSource(workerQueue, {
        batchSize: 1,
        reportBatchItemFailures: true,
      }),
    );

    const retentionFunction = new NodejsFunction(this, 'RetentionFunction', {
      entry: join(__dirname, '../src/retention/index.ts'),
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      memorySize: 512,
      timeout: cdk.Duration.seconds(60),
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node22',
      },
      environment: {
        REPORTS_TABLE_NAME: reportsTable.tableName,
        ATTACHMENTS_BUCKET_NAME: attachmentsBucket.bucketName,
        GITHUB_APP_SECRET_ID: githubAppSecret.secretArn,
        ATTACHMENT_RETENTION_DAYS: '30',
      },
    });
    reportsTable.grantReadWriteData(retentionFunction);
    attachmentsBucket.grantReadWrite(retentionFunction);
    githubAppSecret.grantRead(retentionFunction);
    new Rule(this, 'RetentionSchedule', {
      description: 'Daily issue attachment retention check',
      schedule: Schedule.cron({ hour: '3', minute: '0' }),
      targets: [new LambdaFunction(retentionFunction)],
    });

    const responseHeadersPolicy = new ResponseHeadersPolicy(this, 'ResponseHeadersPolicy', {
      securityHeadersBehavior: {
        strictTransportSecurity: {
          accessControlMaxAge: cdk.Duration.seconds(31_536_000),
          includeSubdomains: true,
          override: true,
        },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: HeadersFrameOption.DENY, override: true },
        referrerPolicy: { referrerPolicy: HeadersReferrerPolicy.NO_REFERRER, override: true },
      },
    });

    const functionUrlOac = new FunctionUrlOriginAccessControl(this, 'IngestFunctionUrlOac');
    const distribution = new Distribution(this, 'Distribution', {
      comment: `Issue intake for ${fqdn}`,
      domainNames: [fqdn],
      certificate,
      priceClass: PriceClass.PRICE_CLASS_100,
      minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2021,
      sslSupportMethod: SSLMethod.SNI,
      defaultBehavior: {
        origin: FunctionUrlOrigin.withOriginAccessControl(ingestFunctionUrl, {
          originAccessControl: functionUrlOac,
        }),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: AllowedMethods.ALLOW_ALL,
        cachedMethods: CachedMethods.CACHE_GET_HEAD_OPTIONS,
        cachePolicy: CachePolicy.CACHING_DISABLED,
        originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        responseHeadersPolicy,
        compress: true,
      },
      additionalBehaviors: {
        '/attachments/*': {
          origin: S3BucketOrigin.withOriginAccessControl(attachmentsBucket),
          viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
          cachedMethods: CachedMethods.CACHE_GET_HEAD,
          cachePolicy: CachePolicy.CACHING_OPTIMIZED,
          responseHeadersPolicy,
          compress: true,
        },
      },
    });

    ingestFunction.addPermission('CloudFrontInvokeFunction', {
      principal: new ServicePrincipal('cloudfront.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceArn: distribution.distributionArn,
    });

    new ARecord(this, 'IssuesAliasV4', {
      zone: hostedZone,
      recordName: 'issues',
      target: RecordTarget.fromAlias(new CloudFrontTarget(distribution)),
    });
    new AaaaRecord(this, 'IssuesAliasV6', {
      zone: hostedZone,
      recordName: 'issues',
      target: RecordTarget.fromAlias(new CloudFrontTarget(distribution)),
    });

    const alarmProps = {
      evaluationPeriods: 1,
      threshold: 0,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    };
    const ingestAlarm = new Alarm(this, 'IngestAlarm', {
      ...alarmProps,
      metric: ingestFunction.metricErrors({ period: cdk.Duration.minutes(5) }),
      alarmDescription: 'Issue intake ingest Lambda errors',
    });
    const workerAlarm = new Alarm(this, 'WorkerAlarm', {
      ...alarmProps,
      metric: workerFunction.metricErrors({ period: cdk.Duration.minutes(5) }),
      alarmDescription: 'Issue intake worker Lambda errors',
    });
    const dlqAlarm = new Alarm(this, 'DlqAlarm', {
      ...alarmProps,
      metric: workerDlq.metricApproximateNumberOfMessagesVisible({
        period: cdk.Duration.minutes(5),
      }),
      alarmDescription: 'Issue intake worker DLQ depth',
    });
    for (const alarm of [ingestAlarm, workerAlarm, dlqAlarm]) {
      alarm.addAlarmAction(new SnsAction(alertsTopic));
    }

    NagSuppressions.addResourceSuppressions(
      attachmentsBucket,
      [
        {
          id: 'AwsSolutions-S1',
          reason:
            'Attachment access is through CloudFront OAC; S3 server access logs are out of scope for this phase.',
        },
      ],
      true,
    );
    NagSuppressions.addResourceSuppressions(distribution, [
      {
        id: 'AwsSolutions-CFR1',
        reason: 'Issue intake is intentionally available to tenant users without geo restrictions.',
      },
      {
        id: 'AwsSolutions-CFR2',
        reason: 'WAF is managed at the platform edge and is out of scope for this stack.',
      },
      {
        id: 'AwsSolutions-CFR3',
        reason: 'CloudFront standard logging is out of scope for this phase.',
      },
    ]);

    const suppressLambdaNag = (lambda: NodejsFunction, wildcardActions: string[]): void => {
      const role = lambda.role;
      if (!role) return;
      NagSuppressions.addResourceSuppressions(
        role,
        [
          {
            id: 'AwsSolutions-IAM4',
            reason: 'CDK uses the AWS managed basic execution policy for CloudWatch Logs.',
            appliesTo: [
              'Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
            ],
          },
          {
            id: 'AwsSolutions-IAM5',
            reason: 'CDK grant helpers generate wildcard S3 actions scoped to stack-owned objects.',
            appliesTo: [...wildcardActions, 'Resource::<AttachmentsBucket8E14A36F.Arn>/*'],
          },
        ],
        true,
      );
    };
    suppressLambdaNag(ingestFunction, [
      'Action::s3:Abort*',
      'Action::s3:DeleteObject*',
      'Action::s3:GetBucket*',
      'Action::s3:GetObject*',
      'Action::s3:List*',
    ]);
    suppressLambdaNag(workerFunction, [
      'Action::s3:GetBucket*',
      'Action::s3:GetObject*',
      'Action::s3:List*',
    ]);
    suppressLambdaNag(retentionFunction, [
      'Action::s3:Abort*',
      'Action::s3:DeleteObject*',
      'Action::s3:GetBucket*',
      'Action::s3:GetObject*',
      'Action::s3:List*',
    ]);
  }
}
