import { Injectable } from '@nestjs/common';

@Injectable()
export class CommonService {
  healthCheck(): boolean {
    return true;
  }
}
