import { describe, expect, it } from 'vitest';
import { createSanitizedChildEnvironment } from './childEnvironment.js';

describe('createSanitizedChildEnvironment', () => {
  it('uses a minimal allowlist and excludes ambient credentials', () => {
    const environment = createSanitizedChildEnvironment({
      HOME: '/home/test',
      PATH: '/usr/bin',
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      GITHUB_TOKEN: 'github-secret',
      AWS_SECRET_ACCESS_KEY: 'aws-secret',
      DATABASE_URL: 'postgres://secret',
      SSH_AUTH_SOCK: '/tmp/agent.sock',
      OPENAI_API_KEY: 'provider-secret'
    });

    expect(environment).toEqual({
      HOME: '/home/test',
      PATH: '/usr/bin',
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8'
    });
  });
});
