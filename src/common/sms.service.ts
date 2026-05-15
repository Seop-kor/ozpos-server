import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';

@Injectable()
export class SmsService {
  constructor(private readonly httpService: HttpService) {}
  async send(phone: string, message: string): Promise<boolean> {
    const res = await this.httpService.axiosRef.post(
      `${process.env.ALIGO_API_URL}/send/`,
      {
        key: process.env.ALIGO_API_KEY,
        user_id: process.env.ALIGO_API_USER_ID,
        sender: process.env.ALIGO_API_SENDER,
        receiver: phone,
        msg: message,
        testmode_yn: 'Y', // TEST Mode
      },
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );

    if (res.status !== 200) {
      throw new Error(res.statusText);
    }

    return true;
  }

  async sendOtp(phone: string, otp: string): Promise<boolean> {
    return await this.send(
      phone,
      `[오즈오더] 본인확인 인증번호[${otp}]를 입력해 주세요.`,
    );
  }
}
