import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { DEV_OTP } from '../src/auth/otp.js';
import { readDeliveredOtpForTests } from '../src/auth/otp-delivery.js';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  const email = `person-${Date.now()}@example.com`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('reports health when Postgres and Redis are up', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200);

    expect(response.body).toEqual({
      status: 'ok',
      database: 'up',
      redis: 'up',
    });
  });

  it('keeps a new email signed out until registration, then rotates and logs out', async () => {
    const agent = request.agent(app.getHttpServer());

    const requested = await agent
      .post('/api/v1/auth/request-otp')
      .set('X-Personal-AI', '1')
      .send({ email })
      .expect(200);
    expect(requested.body).toEqual({ status: 'code_sent' });

    expect(process.env.NODE_ENV).toBe('test');
    const code = readDeliveredOtpForTests(email);
    expect(code).not.toBe(DEV_OTP);

    await agent
      .post('/api/v1/auth/verify-otp')
      .set('X-Personal-AI', '1')
      .send({ email, code: '000000' })
      .expect(401);

    const verified = await agent
      .post('/api/v1/auth/verify-otp')
      .set('X-Personal-AI', '1')
      .send({ email, code })
      .expect(200);

    expect(verified.body.status).toBe('registration_required');
    expect(verified.body.email).toBe(email);
    expect(verified.body.registrationToken).toEqual(expect.any(String));
    expect(verified.headers['set-cookie']).toBeUndefined();
    expect(JSON.stringify(verified.body)).not.toMatch(/accessToken|refreshToken/);
    await agent.get('/api/v1/auth/me').expect(401);

    const registered = await agent
      .post('/api/v1/auth/complete-registration')
      .set('X-Personal-AI', '1')
      .send({ registrationToken: verified.body.registrationToken, name: 'Ada Lovelace' })
      .expect(201);

    expect(registered.body).toEqual({
      user: { id: expect.any(String), email, name: 'Ada Lovelace' },
    });
    const cookies = registered.headers['set-cookie'];
    const joined = Array.isArray(cookies) ? cookies.join(';') : String(cookies ?? '');
    expect(joined).toMatch(/HttpOnly/i);

    const me = await agent.get('/api/v1/auth/me').expect(200);
    expect(me.body).toEqual({ id: registered.body.user.id, email, name: 'Ada Lovelace' });

    await agent.post('/api/v1/auth/refresh').set('X-Personal-AI', '1').expect(200);
    await agent.get('/api/v1/auth/me').expect(200);
    await agent.post('/api/v1/auth/logout').set('X-Personal-AI', '1').expect(204);
    await agent.get('/api/v1/auth/me').expect(401);
  });

  it('signs in an existing user and rejects a reused code', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent
      .post('/api/v1/auth/request-otp')
      .set('X-Personal-AI', '1')
      .send({ email })
      .expect(200);

    const code = readDeliveredOtpForTests(email);
    const signedIn = await agent
      .post('/api/v1/auth/verify-otp')
      .set('X-Personal-AI', '1')
      .send({ email, code })
      .expect(200);

    expect(signedIn.body.status).toBe('authenticated');
    expect(signedIn.body.user.email).toBe(email);

    await agent
      .post('/api/v1/auth/verify-otp')
      .set('X-Personal-AI', '1')
      .send({ email, code })
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/v1/auth/request-otp')
      .send({ email })
      .expect(403);
  });

  it('returns bearer tokens for an existing user and does not set cookies', async () => {
    const requested = await request(app.getHttpServer())
      .post('/api/v1/auth/request-otp')
      .set('X-Token-Delivery', 'bearer')
      .send({ email })
      .expect(200);
    expect(requested.body).toEqual({ status: 'code_sent' });

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/verify-otp')
      .set('X-Token-Delivery', 'bearer')
      .send({ email, code: readDeliveredOtpForTests(email) })
      .expect(200);

    expect(response.body.status).toBe('authenticated');
    expect(response.body.accessToken).toEqual(expect.any(String));
    expect(response.body.refreshToken).toEqual(expect.any(String));
    expect(response.headers['set-cookie']).toBeUndefined();

    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${response.body.accessToken}`)
      .expect(200);
  });
});
