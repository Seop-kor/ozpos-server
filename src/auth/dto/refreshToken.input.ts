import { Field, InputType } from '@nestjs/graphql';
import { IsString, MinLength } from 'class-validator';

@InputType()
export class RefreshTokenPayloadInput {
  @Field(() => String)
  @IsString()
  @MinLength(20)
  refreshToken: string;
}
