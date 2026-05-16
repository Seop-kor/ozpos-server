import { Injectable } from '@nestjs/common';

export type RefreshTokenRecord = {
  userId: string;
  token: string;
  expiresAt: Date;
};

@Injectable()
export class InMemoryRefreshTokenRepository {
  private readonly records = new Map<string, RefreshTokenRecord>();

  save(record: RefreshTokenRecord): Promise<void> {
    this.records.set(record.userId, record);
    return Promise.resolve();
  }

  findByUserId(userId: string): Promise<RefreshTokenRecord | null> {
    return Promise.resolve(this.records.get(userId) ?? null);
  }

  deleteByUserId(userId: string): Promise<void> {
    this.records.delete(userId);
    return Promise.resolve();
  }
}
