import { Injectable } from '@nestjs/common';

import {
  InvalidCredentialsException,
  InvalidTokenException,
} from './auth.exception';
import { InMemoryRefreshTokenRepository } from './refreshToken.repository';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { InMemoryUserRepository } from './user.repository';

export type AuthPayload = {
  accessToken: string;
  refreshToken: string;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly userRepository: InMemoryUserRepository,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
    private readonly refreshTokenRepository: InMemoryRefreshTokenRepository,
  ) {}

  async login(email: string, password: string): Promise<AuthPayload> {
    const user = await this.userRepository.findByEmail(email);

    if (!user) {
      throw new InvalidCredentialsException();
    }

    const passwordMatches = await this.passwordService.verify(
      password,
      user.passwordHash,
    );

    if (!passwordMatches) {
      throw new InvalidCredentialsException();
    }

    const tokens = await this.tokenService.generateAuthTokens(user.id);
    await this.refreshTokenRepository.save({
      userId: user.id,
      token: tokens.refreshToken,
      expiresAt: tokens.refreshExpiresAt,
    });

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  async refreshToken(refreshToken: string): Promise<AuthPayload> {
    const { userId } = await this.tokenService.verifyRefreshToken(refreshToken);
    const storedToken = await this.refreshTokenRepository.findByUserId(userId);

    if (!storedToken || storedToken.token !== refreshToken) {
      throw new InvalidTokenException();
    }

    const tokens = await this.tokenService.generateAuthTokens(userId);
    await this.refreshTokenRepository.save({
      userId,
      token: tokens.refreshToken,
      expiresAt: tokens.refreshExpiresAt,
    });

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }
}
