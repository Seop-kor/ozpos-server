import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType('AuthPayload')
export class AuthPayloadObject {
  @Field(() => String)
  accessToken: string;

  @Field(() => String)
  refreshToken: string;
}
