import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { AuthService } from './auth.service';
import { AuthPayloadObject } from './dto/authPayload.object';
import { LoginInput } from './dto/login.input';
import { RefreshTokenPayloadInput } from './dto/refreshToken.input';

@Resolver()
export class AuthResolver {
  constructor(private readonly authService: AuthService) {}

  @Mutation(() => AuthPayloadObject)
  login(@Args('input') input: LoginInput): Promise<AuthPayloadObject> {
    return this.authService.login(input.email, input.password);
  }

  @Mutation(() => AuthPayloadObject)
  refreshToken(
    @Args('input') input: RefreshTokenPayloadInput,
  ): Promise<AuthPayloadObject> {
    return this.authService.refreshToken(input.refreshToken);
  }

  @Mutation(() => Boolean)
  logout(@Args('input') input: RefreshTokenPayloadInput): Promise<boolean> {
    return this.authService.logout(input.refreshToken);
  }
}
