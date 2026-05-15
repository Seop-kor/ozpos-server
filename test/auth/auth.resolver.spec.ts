import { Test } from '@nestjs/testing';

import { AuthResolver } from '../../src/auth/auth.resolver';
import { AuthService } from '../../src/auth/auth.service';

describe('AuthResolver', () => {
  let authService: jest.Mocked<Pick<AuthService, 'login' | 'refreshToken'>>;
  let resolver: AuthResolver;

  beforeEach(async () => {
    authService = {
      login: jest.fn(),
      refreshToken: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthResolver,
        {
          provide: AuthService,
          useValue: authService,
        },
      ],
    }).compile();

    resolver = moduleRef.get(AuthResolver);
  });

  it('delegates login input to AuthService.login', async () => {
    const payload = {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    };
    authService.login.mockResolvedValue(payload);

    await expect(
      resolver.login({ email: 'owner@ozpos.test', password: 'password123!' }),
    ).resolves.toBe(payload);
    expect(authService.login).toHaveBeenCalledWith(
      'owner@ozpos.test',
      'password123!',
    );
  });

  it('delegates refresh token input to AuthService.refreshToken', async () => {
    const payload = {
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
    };
    authService.refreshToken.mockResolvedValue(payload);

    await expect(
      resolver.refreshToken({ refreshToken: 'header.payload.signature' }),
    ).resolves.toBe(payload);
    expect(authService.refreshToken).toHaveBeenCalledWith(
      'header.payload.signature',
    );
  });
});
