import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import type ms from 'ms';

import { InvalidTokenException } from './auth.exception';

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
};

type TokenPayload = {
  sub: string;
  type: 'access' | 'refresh';
  jti?: string;
  exp?: number;
};

@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async generateAuthTokens(userId: string): Promise<AuthTokens> {
    const secret = this.configService.getOrThrow<string>('JWT_SECRET');
    const accessTtl =
      this.configService.get<ms.StringValue>('JWT_ACCESS_TTL') ?? '15m';
    const refreshTtl =
      this.configService.get<ms.StringValue>('JWT_REFRESH_TTL') ?? '7d';
    const accessToken = await this.jwtService.signAsync(
      { sub: userId, type: 'access', jti: randomUUID() },
      { secret, expiresIn: accessTtl },
    );
    const refreshToken = await this.jwtService.signAsync(
      { sub: userId, type: 'refresh', jti: randomUUID() },
      { secret, expiresIn: refreshTtl },
    );
    const refreshPayload = this.jwtService.decode<TokenPayload>(refreshToken);

    return {
      accessToken,
      refreshToken,
      refreshExpiresAt: new Date((refreshPayload.exp ?? 0) * 1000),
    };
  }

  async verifyRefreshToken(token: string): Promise<{ userId: string }> {
    try {
      const secret = this.configService.getOrThrow<string>('JWT_SECRET');
      const payload = await this.jwtService.verifyAsync<TokenPayload>(token, {
        secret,
      });

      if (
        payload.type !== 'refresh' ||
        typeof payload.sub !== 'string' ||
        payload.sub.length === 0
      ) {
        throw new InvalidTokenException();
      }

      return { userId: payload.sub };
    } catch {
      throw new InvalidTokenException();
    }
  }
}
