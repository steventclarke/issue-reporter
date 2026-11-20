#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { IssueIntakeStack, type IssueIntakeEnvironment } from '../lib/issue-intake-stack';

const app = new cdk.App();
const contextEnvironment = app.node.tryGetContext('environment') ?? 'preview';
if (contextEnvironment !== 'preview' && contextEnvironment !== 'prod') {
  throw new Error('Context environment must be preview or prod');
}

new IssueIntakeStack(app, `IssueIntakeStack-${contextEnvironment}`, {
  environmentName: contextEnvironment as IssueIntakeEnvironment,
  description: `Issue intake backend (${contextEnvironment})`,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-2',
  },
});

cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
