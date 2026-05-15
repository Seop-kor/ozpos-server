import * as bcrypt from 'bcrypt';

import { PasswordService } from '../../src/auth/password.service';

describe('PasswordService.verify', () => {
  let service: PasswordService;

  beforeEach(() => {
    service = new PasswordService();
  });

  it('returns true when plain password matches bcrypt hash', async () => {
    const hash = await bcrypt.hash('password123!', 10);

    await expect(service.verify('password123!', hash)).resolves.toBe(true);
  });

  it('returns false when plain password does not match bcrypt hash', async () => {
    const hash = await bcrypt.hash('password123!', 10);

    await expect(service.verify('wrongpass', hash)).resolves.toBe(false);
  });

  it('returns false when hash is not a bcrypt hash', async () => {
    await expect(
      service.verify('password123!', 'not-a-bcrypt-hash'),
    ).resolves.toBe(false);
  });
});
