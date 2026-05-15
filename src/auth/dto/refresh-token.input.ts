import { Field, InputType } from '@nestjs/graphql';
import { IsString, MinLength } from 'class-validator';

@InputType()
export class RefreshTokenInput {
  @Field(() => String)
  @IsString()
  @MinLength(20)
  refreshToken: string;
}
