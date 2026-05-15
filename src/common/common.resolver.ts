import { Query, Resolver } from '@nestjs/graphql';

import { CommonService } from './common.service';

@Resolver()
export class CommonResolver {
  constructor(private commonService: CommonService) {}

  @Query(() => Boolean)
  healthCheck(): boolean {
    const healthCheck = this.commonService.healthCheck();
    return healthCheck;
  }
}
