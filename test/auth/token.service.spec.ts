import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { InvalidTokenException } from '../../src/auth/auth.exception';
import { TokenService } from '../../src/auth/token.service';

const jwtService = new JwtService();

type DecodedToken = {
  sub: string;
  type: string;
  exp: number;
};

function createService(
  config: Record<string, string | undefined> = { JWT_SECRET: 'test-secret' },
) {
  return new TokenService(jwtService, new ConfigService(config));
}

describe('TokenService.generateAuthTokens', () => {
  it('issues access and refresh tokens together', async () => {
    const service = createService();

    const result = await service.generateAuthTokens('dummy-user-1');

    expect(result.accessToken.split('.')).toHaveLength(3);
    expect(result.refreshToken.split('.')).toHaveLength(3);
    expect(result.refreshExpiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('puts subject and access type in access token payload', async () => {
    const service = createService();

    const { accessToken } = await service.generateAuthTokens('dummy-user-1');
    const payload = jwtService.decode<DecodedToken>(accessToken);

    expect(payload.sub).toBe('dummy-user-1');
    expect(payload.type).toBe('access');
  });

  it('puts subject and refresh type in refresh token payload', async () => {
    const service = createService();

    const { refreshToken } = await service.generateAuthTokens('dummy-user-1');
    const payload = jwtService.decode<DecodedToken>(refreshToken);

    expect(payload.sub).toBe('dummy-user-1');
    expect(payload.type).toBe('refresh');
  });

  it('returns refresh expiration matching refresh token exp claim', async () => {
    const service = createService();

    const { refreshToken, refreshExpiresAt } =
      await service.generateAuthTokens('dummy-user-1');
    const payload = jwtService.decode<DecodedToken>(refreshToken);

    expect(Math.floor(refreshExpiresAt.getTime() / 1000)).toBe(payload.exp);
  });

  it('throws when JWT secret is missing', async () => {
    const service = createService({});

    await expect(service.generateAuthTokens('dummy-user-1')).rejects.toThrow();
  });
});

describe('TokenService.verifyRefreshToken', () => {
  it('returns user id for a valid refresh token', async () => {
    const service = createService();
    const { refreshToken } = await service.generateAuthTokens('dummy-user-1');

    await expect(service.verifyRefreshToken(refreshToken)).resolves.toEqual({
      userId: 'dummy-user-1',
    });
  });

  it('throws InvalidTokenException for an access token', async () => {
    const service = createService();
    const { accessToken } = await service.generateAuthTokens('dummy-user-1');

    await expect(
      service.verifyRefreshToken(accessToken),
    ).rejects.toBeInstanceOf(InvalidTokenException);
  });

  it('throws InvalidTokenException for a token signed with another secret', async () => {
    const service = createService();
    const token = await jwtService.signAsync(
      { sub: 'dummy-user-1', type: 'refresh' },
      { secret: 'other-secret', expiresIn: '7d' },
    );

    await expect(service.verifyRefreshToken(token)).rejects.toBeInstanceOf(
      InvalidTokenException,
    );
  });

  it('throws InvalidTokenException for an expired refresh token', async () => {
    const service = createService();
    const token = await jwtService.signAsync(
      { sub: 'dummy-user-1', type: 'refresh' },
      { secret: 'test-secret', expiresIn: '-1s' },
    );

    await expect(service.verifyRefreshToken(token)).rejects.toBeInstanceOf(
      InvalidTokenException,
    );
  });

  it('throws InvalidTokenException for malformed token text', async () => {
    const service = createService();

    await expect(
      service.verifyRefreshToken('not-a-jwt-token-value'),
    ).rejects.toBeInstanceOf(InvalidTokenException);
  });
});
