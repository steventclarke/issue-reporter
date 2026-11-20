import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { CachePolicy } from 'aws-cdk-lib/aws-cloudfront';
import { IssueIntakeStack } from '../../lib/issue-intake-stack';

type TemplateResource = {
  Type?: string;
  Properties?: Record<string, unknown>;
  DeletionPolicy?: string;
  UpdateReplacePolicy?: string;
};

type TemplateJson = {
  Parameters?: Record<string, { Default?: string }>;
  Resources?: Record<string, TemplateResource>;
};

describe('IssueIntakeStack', () => {
  let template: Template;
  let json: TemplateJson;

  beforeAll(() => {
    const app = new App();
    const stack = new IssueIntakeStack(app, 'TestIssueIntakeStack', {
      environmentName: 'preview',
      env: { account: '111111111111', region: 'us-east-2' },
    });
    template = Template.fromStack(stack);
    json = template.toJSON() as TemplateJson;
  });

  it('reads the four shared SSM values', () => {
    const defaults = Object.values(json.Parameters ?? {}).map((parameter) => parameter.Default);
    expect(defaults).toEqual(
      expect.arrayContaining([
        '/platform/dns/hosted-zone-id',
        '/platform/dns/domain-name',
        '/platform/certs/us-east-1/wildcard-arn',
        '/platform/monitoring/alerts-topic-arn',
      ]),
    );
  });

  it('publishes API and per-app SSM outputs', () => {
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/platform/issue-intake/api-url',
      Value: Match.anyValue(),
    });
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/platform/issue-intake/apps/iron-altar/app-id',
      Value: 'iron-altar',
    });
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/platform/issue-intake/apps/iron-altar/repo',
      Value: 'steventclarke/iron-altar',
    });
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/platform/issue-intake/apps/iron-altar/labels',
      Value: '["app:iron-altar"]',
    });
  });

  it('creates a retained on-demand reports table with TTL and PITR', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      BillingMode: 'PAY_PER_REQUEST',
      SSESpecification: { SSEEnabled: true },
      TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
    });
    template.hasResource('AWS::DynamoDB::Table', {
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
    });
  });

  it('creates a private retained attachments bucket with closure expiry', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      BucketEncryption: Match.objectLike({
        ServerSideEncryptionConfiguration: Match.anyValue(),
      }),
      LifecycleConfiguration: {
        Rules: Match.arrayWith([
          Match.objectLike({
            ExpirationInDays: 30,
            TagFilters: [{ Key: 'closure-marker', Value: 'true' }],
          }),
          Match.objectLike({
            AbortIncompleteMultipartUpload: Match.objectLike({ DaysAfterInitiation: 7 }),
          }),
        ]),
      },
    });
    template.hasResource('AWS::S3::Bucket', {
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
    });
  });

  it('grants CloudFront OAC read access to attachments', () => {
    template.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 's3:GetObject',
            Effect: 'Allow',
            Principal: { Service: 'cloudfront.amazonaws.com' },
          }),
        ]),
      },
    });
  });

  it('creates the worker queue and retention DLQ', () => {
    template.hasResourceProperties('AWS::SQS::Queue', {
      MessageRetentionPeriod: 345600,
      VisibilityTimeout: 180,
      SqsManagedSseEnabled: true,
      RedrivePolicy: Match.objectLike({ maxReceiveCount: 5 }),
    });
    template.hasResourceProperties('AWS::SQS::Queue', {
      MessageRetentionPeriod: 1209600,
      SqsManagedSseEnabled: true,
    });
  });

  it('configures the ingest function URL with AWS_IAM auth', () => {
    template.hasResourceProperties('AWS::Lambda::Url', { AuthType: 'AWS_IAM' });
    template.hasResourceProperties('AWS::CloudFront::OriginAccessControl', {
      OriginAccessControlConfig: Match.objectLike({
        OriginAccessControlOriginType: 'lambda',
        SigningBehavior: 'always',
        SigningProtocol: 'sigv4',
      }),
    });
    template.hasResourceProperties('AWS::Lambda::Permission', {
      Action: 'lambda:InvokeFunctionUrl',
      Principal: 'cloudfront.amazonaws.com',
    });
  });

  it('configures Node 22 ARM Lambda functions', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
      Architectures: ['arm64'],
      MemorySize: 512,
      Timeout: 10,
    });
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
      Architectures: ['arm64'],
      MemorySize: 512,
      Timeout: 30,
    });
  });

  it('wires the worker queue with partial batch failures', () => {
    template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      BatchSize: 1,
      FunctionResponseTypes: ['ReportBatchItemFailures'],
    });
  });

  it('creates the GitHub App secret and daily retention schedule', () => {
    template.hasResourceProperties('AWS::SecretsManager::Secret', {
      Name: '/platform/issue-intake/github-app',
    });
    template.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'cron(0 3 * * ? *)',
      State: 'ENABLED',
    });
  });

  it('configures both CloudFront behaviors and response headers', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        PriceClass: 'PriceClass_100',
        ViewerCertificate: Match.objectLike({
          MinimumProtocolVersion: 'TLSv1.2_2021',
          SslSupportMethod: 'sni-only',
        }),
        DefaultCacheBehavior: Match.objectLike({
          AllowedMethods: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'PATCH', 'POST', 'DELETE'],
          CachePolicyId: CachePolicy.CACHING_DISABLED.cachePolicyId,
        }),
        CacheBehaviors: Match.arrayWith([
          Match.objectLike({
            PathPattern: '/attachments/*',
            AllowedMethods: ['GET', 'HEAD'],
            CachePolicyId: CachePolicy.CACHING_OPTIMIZED.cachePolicyId,
          }),
        ]),
      }),
    });
    template.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
      ResponseHeadersPolicyConfig: {
        SecurityHeadersConfig: Match.objectLike({
          ContentTypeOptions: { Override: true },
          FrameOptions: { FrameOption: 'DENY', Override: true },
          ReferrerPolicy: { ReferrerPolicy: 'no-referrer', Override: true },
          StrictTransportSecurity: Match.objectLike({ Override: true }),
        }),
      },
    });
  });

  it('creates A and AAAA aliases for the issues hostname', () => {
    template.resourceCountIs('AWS::Route53::RecordSet', 2);
    template.hasResourceProperties('AWS::Route53::RecordSet', { Type: 'A' });
    template.hasResourceProperties('AWS::Route53::RecordSet', { Type: 'AAAA' });
  });

  it('sends ingest, worker, and DLQ alarms to the shared topic', () => {
    template.resourceCountIs('AWS::CloudWatch::Alarm', 3);
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      MetricName: 'Errors',
      Namespace: 'AWS/Lambda',
      Period: 300,
      Threshold: 0,
      AlarmActions: Match.anyValue(),
    });
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      MetricName: 'ApproximateNumberOfMessagesVisible',
      Namespace: 'AWS/SQS',
      Period: 300,
      Threshold: 0,
      AlarmActions: Match.anyValue(),
    });
  });

  it('tags every taggable resource with the required platform tags', () => {
    const resources = Object.values(json.Resources ?? {});
    const taggable = resources.filter((resource) => resource.Properties?.Tags !== undefined);
    expect(taggable.length).toBeGreaterThan(0);
    for (const resource of taggable) {
      const tags = JSON.stringify(resource.Properties?.Tags);
      expect(tags).toContain('project');
      expect(tags).toContain('environment');
      expect(tags).toContain('owner');
      expect(tags).toContain('application');
      expect(tags).toContain('managed-by');
    }
  });
});
