import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';

import { CommonResolver } from './common.resolver';
import { CommonService } from './common.service';
import { SmsService } from './sms.service';
import { UtilService } from './util.service';

@Module({
  imports: [HttpModule],
  providers: [CommonResolver, CommonService, SmsService, UtilService],
  exports: [SmsService, UtilService, CommonService],
})
export class CommonModule {}
