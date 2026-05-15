import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AuthResolver } from './auth.resolver';
import { AuthService } from './auth.service';
import { InMemoryRefreshTokenRepository } from './refreshToken.repository';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { InMemoryUserRepository } from './user.repository';

@Module({
  imports: [JwtModule.register({})],
  providers: [
    AuthResolver,
    AuthService,
    PasswordService,
    TokenService,
    InMemoryUserRepository,
    InMemoryRefreshTokenRepository,
  ],
})
export class AuthModule {}
