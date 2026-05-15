import { Injectable } from '@nestjs/common';

@Injectable()
export class UtilService {
  getOtp(): string {
    // 6 digit
    // 100000 ~ 999999
    const otpNumber = Math.floor(Math.random() * 900000) + 100000;

    return otpNumber.toString();
  }
}
