import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { AuthService } from './auth.service';
import { AuthPayloadObject } from './dto/auth-payload.object';
import { LoginInput } from './dto/login.input';
import { RefreshTokenInput } from './dto/refresh-token.input';

@Resolver()
export class AuthResolver {
  constructor(private readonly authService: AuthService) {}

  @Mutation(() => AuthPayloadObject)
  login(@Args('input') input: LoginInput): Promise<AuthPayloadObject> {
    return this.authService.login(input.email, input.password);
  }

  @Mutation(() => AuthPayloadObject)
  refreshToken(
    @Args('input') input: RefreshTokenInput,
  ): Promise<AuthPayloadObject> {
    return this.authService.refreshToken(input.refreshToken);
  }
}
