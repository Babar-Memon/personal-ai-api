import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { readDeliveredOtpForTests } from '../src/auth/otp-delivery.js';

describe('Tasks and reminders (e2e)', () => {
  let app: INestApplication;
  const email = `tasks-${Date.now()}@example.com`;
  const other = `other-${Date.now()}@example.com`;

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

  async function signIn(address: string, name: string) {
    const agent = request.agent(app.getHttpServer());
    await agent
      .post('/api/v1/auth/request-otp')
      .set('X-Personal-AI', '1')
      .send({ email: address })
      .expect(200);
    const verified = await agent
      .post('/api/v1/auth/verify-otp')
      .set('X-Personal-AI', '1')
      .send({ email: address, code: readDeliveredOtpForTests(address) })
      .expect(200);
    await agent
      .post('/api/v1/auth/complete-registration')
      .set('X-Personal-AI', '1')
      .send({ registrationToken: verified.body.registrationToken, name })
      .expect(201);
    return agent;
  }

  it('keeps tasks and reminders private to the signed-in user', async () => {
    const owner = await signIn(email, 'Owner');
    const stranger = await signIn(other, 'Stranger');

    await request(app.getHttpServer()).get('/api/v1/tasks').expect(401);
    await owner.post('/api/v1/tasks').set('X-Personal-AI', '1').send({}).expect(400);

    const created = await owner
      .post('/api/v1/tasks')
      .set('X-Personal-AI', '1')
      .send({
        title: 'Finish the project',
        priority: 'high',
        dueAt: '2026-10-17T09:00:00.000Z',
      })
      .expect(201);
    expect(created.body.title).toBe('Finish the project');

    const listed = await owner
      .get('/api/v1/tasks')
      .query({ status: 'open', sort: 'priority' })
      .expect(200);
    expect(listed.body.map((task: { id: string }) => task.id)).toContain(created.body.id);

    const done = await owner
      .patch(`/api/v1/tasks/${created.body.id}`)
      .set('X-Personal-AI', '1')
      .send({ status: 'done' })
      .expect(200);
    expect(done.body.status).toBe('done');

    await owner
      .patch(`/api/v1/tasks/${created.body.id}`)
      .set('X-Personal-AI', '1')
      .send({ status: 'open' })
      .expect(200);

    await stranger.get(`/api/v1/tasks/${created.body.id}`).expect(404);
    await stranger
      .patch(`/api/v1/tasks/${created.body.id}`)
      .set('X-Personal-AI', '1')
      .send({ title: 'Stolen' })
      .expect(404);

    const bearer = await request(app.getHttpServer())
      .post('/api/v1/auth/request-otp')
      .set('X-Token-Delivery', 'bearer')
      .send({ email })
      .expect(200);
    expect(bearer.body.status).toBe('code_sent');
    const mobile = await request(app.getHttpServer())
      .post('/api/v1/auth/verify-otp')
      .set('X-Token-Delivery', 'bearer')
      .send({ email, code: readDeliveredOtpForTests(email) })
      .expect(200);
    const seen = await request(app.getHttpServer())
      .get('/api/v1/tasks')
      .set('Authorization', `Bearer ${mobile.body.accessToken}`)
      .expect(200);
    expect(seen.body.map((task: { id: string }) => task.id)).toContain(created.body.id);

    const reminder = await owner
      .post('/api/v1/reminders')
      .set('X-Personal-AI', '1')
      .send({ title: 'Stand up', remindAt: '2026-10-17T09:00:00.000Z' })
      .expect(201);
    const moved = await owner
      .patch(`/api/v1/reminders/${reminder.body.id}`)
      .set('X-Personal-AI', '1')
      .send({ remindAt: '2026-10-17T15:00:00.000Z', status: 'scheduled' })
      .expect(200);
    expect(moved.body.remindAt).toContain('2026-10-17T15:00:00');

    await stranger.delete(`/api/v1/reminders/${reminder.body.id}`).set('X-Personal-AI', '1').expect(404);
    await owner.delete(`/api/v1/tasks/${created.body.id}`).set('X-Personal-AI', '1').expect(204);
    await owner.delete(`/api/v1/reminders/${reminder.body.id}`).set('X-Personal-AI', '1').expect(204);
    await owner.get(`/api/v1/tasks/${created.body.id}`).expect(404);
  });
});
