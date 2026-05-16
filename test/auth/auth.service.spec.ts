import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { AuthService } from '../../src/auth/auth.service';
import {
  InvalidCredentialsException,
  InvalidTokenException,
} from '../../src/auth/auth.exception';
import { InMemoryRefreshTokenRepository } from '../../src/auth/refreshToken.repository';
import { PasswordService } from '../../src/auth/password.service';
import { TokenService } from '../../src/auth/token.service';
import { InMemoryUserRepository } from '../../src/auth/user.repository';

function createAuthFixture() {
  const refreshTokenRepository = new InMemoryRefreshTokenRepository();
  const service = new AuthService(
    new InMemoryUserRepository(),
    new PasswordService(),
    new TokenService(
      new JwtService(),
      new ConfigService({ JWT_SECRET: 'test-secret' }),
    ),
    refreshTokenRepository,
  );

  return { refreshTokenRepository, service };
}

describe('AuthService.login', () => {
  it('logs in with valid credentials and stores returned refresh token', async () => {
    const { refreshTokenRepository, service } = createAuthFixture();

    const result = await service.login('owner@ozpos.test', 'password123!');

    expect(result.accessToken.split('.')).toHaveLength(3);
    expect(result.refreshToken.split('.')).toHaveLength(3);
    await expect(
      refreshTokenRepository.findByUserId('dummy-user-1'),
    ).resolves.toMatchObject({
      token: result.refreshToken,
      userId: 'dummy-user-1',
    });
  });

  it('throws InvalidCredentialsException for unknown email and leaves refresh store empty', async () => {
    const { refreshTokenRepository, service } = createAuthFixture();

    await expect(
      service.login('missing@ozpos.test', 'password123!'),
    ).rejects.toBeInstanceOf(InvalidCredentialsException);
    await expect(
      refreshTokenRepository.findByUserId('dummy-user-1'),
    ).resolves.toBeNull();
  });

  it('throws InvalidCredentialsException for wrong password and leaves refresh store empty', async () => {
    const { refreshTokenRepository, service } = createAuthFixture();

    await expect(
      service.login('owner@ozpos.test', 'wrongpass'),
    ).rejects.toBeInstanceOf(InvalidCredentialsException);
    await expect(
      refreshTokenRepository.findByUserId('dummy-user-1'),
    ).resolves.toBeNull();
  });

  it('rotates current refresh token on re-login', async () => {
    const { refreshTokenRepository, service } = createAuthFixture();

    const first = await service.login('owner@ozpos.test', 'password123!');
    const second = await service.login('owner@ozpos.test', 'password123!');

    expect(second.refreshToken).not.toBe(first.refreshToken);
    await expect(
      refreshTokenRepository.findByUserId('dummy-user-1'),
    ).resolves.toMatchObject({
      token: second.refreshToken,
    });
  });
});

describe('AuthService.refreshToken', () => {
  it('issues new tokens for stored refresh token and stores the new refresh token', async () => {
    const { refreshTokenRepository, service } = createAuthFixture();
    const loginResult = await service.login('owner@ozpos.test', 'password123!');

    const result = await service.refreshToken(loginResult.refreshToken);

    expect(result.accessToken.split('.')).toHaveLength(3);
    expect(result.refreshToken.split('.')).toHaveLength(3);
    expect(result.refreshToken).not.toBe(loginResult.refreshToken);
    await expect(
      refreshTokenRepository.findByUserId('dummy-user-1'),
    ).resolves.toMatchObject({
      token: result.refreshToken,
      userId: 'dummy-user-1',
    });
  });

  it('throws InvalidTokenException when a rotated old refresh token is reused', async () => {
    const { service } = createAuthFixture();
    const loginResult = await service.login('owner@ozpos.test', 'password123!');
    await service.refreshToken(loginResult.refreshToken);

    await expect(
      service.refreshToken(loginResult.refreshToken),
    ).rejects.toBeInstanceOf(InvalidTokenException);
  });

  it('accepts the new refresh token after rotation', async () => {
    const { service } = createAuthFixture();
    const loginResult = await service.login('owner@ozpos.test', 'password123!');
    const rotated = await service.refreshToken(loginResult.refreshToken);

    const result = await service.refreshToken(rotated.refreshToken);

    expect(result.accessToken.split('.')).toHaveLength(3);
    expect(result.refreshToken).not.toBe(rotated.refreshToken);
  });

  it('throws InvalidTokenException when no refresh token is stored', async () => {
    const { service } = createAuthFixture();
    const tokenService = new TokenService(
      new JwtService(),
      new ConfigService({ JWT_SECRET: 'test-secret' }),
    );
    const { refreshToken } =
      await tokenService.generateAuthTokens('dummy-user-1');

    await expect(service.refreshToken(refreshToken)).rejects.toBeInstanceOf(
      InvalidTokenException,
    );
  });

  it('throws InvalidTokenException for an access token', async () => {
    const { service } = createAuthFixture();
    const loginResult = await service.login('owner@ozpos.test', 'password123!');

    await expect(
      service.refreshToken(loginResult.accessToken),
    ).rejects.toBeInstanceOf(InvalidTokenException);
  });

  it('throws InvalidTokenException for malformed token text', async () => {
    const { service } = createAuthFixture();

    await expect(
      service.refreshToken('not-a-jwt-token-value'),
    ).rejects.toBeInstanceOf(InvalidTokenException);
  });
});

describe('AuthService.logout', () => {
  it('deletes the stored refresh token and returns true', async () => {
    const { refreshTokenRepository, service } = createAuthFixture();
    const loginResult = await service.login('owner@ozpos.test', 'password123!');

    await expect(service.logout(loginResult.refreshToken)).resolves.toBe(true);
    await expect(
      refreshTokenRepository.findByUserId('dummy-user-1'),
    ).resolves.toBeNull();
  });

  it('prevents refreshing with a logged out refresh token', async () => {
    const { service } = createAuthFixture();
    const loginResult = await service.login('owner@ozpos.test', 'password123!');

    await service.logout(loginResult.refreshToken);

    await expect(
      service.refreshToken(loginResult.refreshToken),
    ).rejects.toBeInstanceOf(InvalidTokenException);
  });

  it('throws InvalidTokenException when logging out with a rotated old refresh token', async () => {
    const { service } = createAuthFixture();
    const loginResult = await service.login('owner@ozpos.test', 'password123!');
    await service.refreshToken(loginResult.refreshToken);

    await expect(
      service.logout(loginResult.refreshToken),
    ).rejects.toBeInstanceOf(InvalidTokenException);
  });

  it('throws InvalidTokenException when logging out with an access token', async () => {
    const { service } = createAuthFixture();
    const loginResult = await service.login('owner@ozpos.test', 'password123!');

    await expect(
      service.logout(loginResult.accessToken),
    ).rejects.toBeInstanceOf(InvalidTokenException);
  });

  it('throws InvalidTokenException when logging out with malformed token text', async () => {
    const { service } = createAuthFixture();

    await expect(
      service.logout('not-a-jwt-token-value'),
    ).rejects.toBeInstanceOf(InvalidTokenException);
  });

  it('throws InvalidTokenException when no refresh token is stored', async () => {
    const { service } = createAuthFixture();
    const tokenService = new TokenService(
      new JwtService(),
      new ConfigService({ JWT_SECRET: 'test-secret' }),
    );
    const { refreshToken } =
      await tokenService.generateAuthTokens('dummy-user-1');

    await expect(service.logout(refreshToken)).rejects.toBeInstanceOf(
      InvalidTokenException,
    );
  });
});
