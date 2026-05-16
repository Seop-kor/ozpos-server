import { readFileSync } from 'fs';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module';

describe('Auth GraphQL schema', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('exposes refreshToken and logout with RefreshTokenPayloadInput', () => {
    const schema = readFileSync('schema.gql', 'utf8');

    expect(schema).toContain(
      'logout(input: RefreshTokenPayloadInput!): Boolean!',
    );
    expect(schema).toContain(
      'refreshToken(input: RefreshTokenPayloadInput!): AuthPayload!',
    );
    expect(schema).toContain('input RefreshTokenPayloadInput');
  });
});
