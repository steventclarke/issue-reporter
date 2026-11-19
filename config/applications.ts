export type IssueIntakeAuthConfig =
  | { mode: 'none' }
  | {
      mode: 'oidc';
      issuer: string;
      audience: string;
      tokenUse: 'id';
      allowedGroups?: string[];
      allowedEmailDomains?: string[];
      allowedSubjects?: string[];
      clockToleranceSeconds?: number;
      jwksCacheTtlSeconds?: number;
    };

export type IssueIntakeConfig = {
  enabled: boolean;
  environments: string[];
  categories: string[];
  reporterProviders: string[];
  labels?: string[];
  auth?: IssueIntakeAuthConfig;
};

export type ApplicationConfig = {
  name: string;
  repo: string;
  issueIntake?: IssueIntakeConfig;
};

export const applications: ApplicationConfig[] = [
  {
    name: 'iron-altar',
    repo: 'steventclarke/iron-altar',
    issueIntake: {
      enabled: true,
      environments: ['prod', 'preview', 'dev'],
      categories: ['bug', 'feature', 'question', 'other'],
      reporterProviders: ['cognito'],
      labels: ['app:iron-altar'],
      auth: { mode: 'none' },
    },
  },
];

export const allowedOrigins = [
  'https://iron-altar.stevenclarke.dev',
  'https://iron-altar-preview.stevenclarke.dev',
  'http://localhost:8081',
  'http://localhost:19006',
] as const;
