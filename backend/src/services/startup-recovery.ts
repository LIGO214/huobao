import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'

/** Interrupted executions fail locally; keep upstream IDs and never resubmit paid requests. */
export async function markInterruptedLocalTasks(): Promise<void> {
  const timestamp = now()
  await db.transaction(async tx => {
    await tx.update(schema.sysTask).set({
      status: 'failed', errorMsg: '服务重启，本地执行已中断；上游任务状态未确认', updatedAt: timestamp,
    }).where(eq(schema.sysTask.status, 'processing'))
    await tx.update(schema.agentTasks).set({
      status: 'failed', errorMsg: '服务重启，Agent 执行已中断', updatedAt: timestamp,
    }).where(eq(schema.agentTasks.status, 'processing'))
    await tx.update(schema.videoMerges).set({
      status: 'failed', errorMsg: '服务重启，视频合并已中断',
    }).where(eq(schema.videoMerges.status, 'processing'))
  })
}
