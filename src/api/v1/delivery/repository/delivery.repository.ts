import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { DeliveryRequestDto } from '../controller/dto/delivery-request.dto';
import { DeliveryMessage } from '../delivery.entity';
import { DeliveryChannel } from '../delivery.constants';

type QueryRow = Record<string, unknown>;

export interface DeliveryOutboxMetrics {
  pending: number;
  processing: number;
  failed: number;
  dead: number;
  oldestPendingSeconds: number;
}

export interface ClaimedDelivery extends DeliveryMessage {
  attempts: number;
}

@Injectable()
export class DeliveryRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async accept(request: DeliveryRequestDto, expiresAt: Date): Promise<'accepted' | 'duplicate'> {
    return this.dataSource.transaction(async (manager) => {
      const inserted = this.rows(
        await manager.query(
          `
            INSERT INTO delivery_event (
              event_uuid,
              event_type,
              schema_version,
              occurred_at,
              expires_at,
              channel,
              payload
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
            ON CONFLICT (event_uuid) DO NOTHING
            RETURNING event_uuid
          `,
          [
            request.eventUuid,
            request.eventType,
            request.schemaVersion,
            request.occurredAt,
            expiresAt,
            request.channel,
            JSON.stringify(request.payload),
          ],
        ),
      );

      if (inserted.length === 0) {
        return 'duplicate';
      }

      await manager.query(
        `
          INSERT INTO delivery_outbox (event_uuid)
          VALUES ($1)
        `,
        [request.eventUuid],
      );

      return 'accepted';
    });
  }

  async claimOutbox(batchSize: number, maxAttempts: number, processingTimeoutMs: number): Promise<ClaimedDelivery[]> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        `
          UPDATE delivery_outbox
          SET
            status = CASE
              WHEN attempts + 1 >= $2 THEN 'dead'
              ELSE 'failed'
            END,
            attempts = attempts + 1,
            processing_started_at = NULL,
            next_attempt_at = NOW(),
            last_error = 'processing timeout'
          WHERE status = 'processing'
            AND processing_started_at < NOW() - ($1 * INTERVAL '1 millisecond')
        `,
        [processingTimeoutMs, maxAttempts],
      );

      const rows = this.rows(
        await manager.query(
          `
            WITH claimed AS (
              SELECT event_uuid
              FROM delivery_outbox
              WHERE status IN ('pending', 'failed')
                AND attempts < $1
                AND next_attempt_at <= NOW()
                AND NOT EXISTS (
                  SELECT 1
                  FROM delivery_outbox AS earlier_outbox
                  JOIN delivery_event AS earlier_event
                    ON earlier_event.event_uuid = earlier_outbox.event_uuid
                  JOIN delivery_event AS current_event
                    ON current_event.event_uuid = delivery_outbox.event_uuid
                  WHERE earlier_event.channel = current_event.channel
                    AND earlier_event.sequence < current_event.sequence
                    AND earlier_outbox.status <> 'published'
                )
              ORDER BY created_at ASC
              LIMIT $2
              FOR UPDATE SKIP LOCKED
            )
            UPDATE delivery_outbox AS outbox
            SET
              status = 'processing',
              processing_started_at = NOW(),
              last_error = NULL
            FROM claimed, delivery_event AS event
            WHERE outbox.event_uuid = claimed.event_uuid
              AND event.event_uuid = outbox.event_uuid
            RETURNING
              event.sequence,
              event.event_uuid,
              event.event_type,
              event.schema_version,
              event.occurred_at,
              event.expires_at,
              event.channel,
              event.payload,
              outbox.attempts
          `,
          [maxAttempts, batchSize],
        ),
      );

      return rows.map((row) => ({ ...this.message(row), attempts: Number(row.attempts) }));
    });
  }

  markPublished(eventUuid: string, attempts: number): Promise<unknown> {
    return this.dataSource.manager.query(
      `
        UPDATE delivery_outbox
        SET
          status = 'published',
          attempts = $2,
          published_at = NOW(),
          processing_started_at = NULL,
          last_error = NULL
        WHERE event_uuid = $1
      `,
      [eventUuid, attempts + 1],
    );
  }

  markFailed(
    eventUuid: string,
    attempts: number,
    retryAt: Date,
    error: unknown,
    terminal: boolean,
  ): Promise<unknown> {
    return this.dataSource.manager.query(
      `
        UPDATE delivery_outbox
        SET
          status = $5,
          attempts = $2,
          next_attempt_at = $3,
          processing_started_at = NULL,
          last_error = $4
        WHERE event_uuid = $1
      `,
      [eventUuid, attempts + 1, retryAt, error instanceof Error ? error.message : String(error), terminal ? 'dead' : 'failed'],
    );
  }

  async getOrCreateCursor(sessionUuid: string, userUuid: string, channel: DeliveryChannel): Promise<string> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        `
          INSERT INTO delivery_cursor (session_uuid, channel, user_uuid)
          VALUES ($1::uuid, $3, $2::uuid)
          ON CONFLICT (session_uuid, channel) DO NOTHING
        `,
        [sessionUuid, userUuid, channel],
      );

      const [row] = this.rows(
        await manager.query(
          `
            SELECT user_uuid, sequence
            FROM delivery_cursor
            WHERE session_uuid = $1
              AND channel = $2
            FOR UPDATE
          `,
          [sessionUuid, channel],
        ),
      );
      if (!row || String(row.user_uuid) !== userUuid) {
        throw new Error('Socket session belongs to another user');
      }

      return String(row.sequence);
    });
  }

  acknowledge(sessionUuid: string, userUuid: string, channel: DeliveryChannel, sequence: string): Promise<unknown> {
    return this.dataSource.manager.query(
      `
        UPDATE delivery_cursor
        SET
          sequence = GREATEST(sequence, $4::bigint),
          acknowledged_at = NOW()
        WHERE session_uuid = $1
          AND user_uuid = $2
          AND channel = $3
      `,
      [sessionUuid, userUuid, channel, sequence],
    );
  }

  async highWatermark(channel: DeliveryChannel): Promise<string> {
    const [row] = this.rows(
      await this.dataSource.manager.query(
        'SELECT COALESCE(MAX(sequence), 0) AS sequence FROM delivery_event WHERE channel = $1',
        [channel],
      ),
    );
    return String(row?.sequence ?? '0');
  }

  async replay(channel: DeliveryChannel, after: string, upTo: string, limit: number): Promise<DeliveryMessage[]> {
    const rows = this.rows(
      await this.dataSource.manager.query(
        `
          SELECT
            sequence,
            event_uuid,
            event_type,
            schema_version,
            occurred_at,
            expires_at,
            channel,
            payload
          FROM delivery_event
          WHERE channel = $1
            AND sequence > $2::bigint
            AND sequence <= $3::bigint
            AND expires_at > NOW()
          ORDER BY sequence ASC
          LIMIT $4
        `,
        [channel, after, upTo, limit],
      ),
    );

    return rows.map((row) => this.message(row));
  }

  async cleanupExpired(): Promise<number> {
    const rows = this.rows(
      await this.dataSource.manager.query(`
        DELETE FROM delivery_event AS event
        USING delivery_outbox AS outbox
        WHERE outbox.event_uuid = event.event_uuid
          AND outbox.status = 'published'
          AND event.expires_at <= NOW()
        RETURNING event.event_uuid
      `),
    );
    return rows.length;
  }

  async outboxMetrics(): Promise<DeliveryOutboxMetrics> {
    const [row] = this.rows(
      await this.dataSource.manager.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
          COUNT(*) FILTER (WHERE status = 'processing')::int AS processing,
          COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
          COUNT(*) FILTER (WHERE status = 'dead')::int AS dead,
          COALESCE(
            EXTRACT(EPOCH FROM (NOW() - MIN(created_at) FILTER (WHERE status IN ('pending', 'processing', 'failed'))))::int,
            0
          ) AS oldest_pending_seconds
        FROM delivery_outbox
      `),
    );

    return {
      pending: Number(row?.pending ?? 0),
      processing: Number(row?.processing ?? 0),
      failed: Number(row?.failed ?? 0),
      dead: Number(row?.dead ?? 0),
      oldestPendingSeconds: Number(row?.oldest_pending_seconds ?? 0),
    };
  }

  databaseReady(): Promise<unknown> {
    return this.dataSource.query('SELECT 1');
  }

  private message(row: QueryRow): DeliveryMessage {
    return {
      channel: String(row.channel) as DeliveryChannel,
      deliveryId: String(row.event_uuid),
      sequence: String(row.sequence),
      eventType: String(row.event_type),
      schemaVersion: Number(row.schema_version),
      occurredAt: new Date(String(row.occurred_at)).toISOString(),
      expiresAt: new Date(String(row.expires_at)).toISOString(),
      payload: row.payload as Record<string, unknown>,
    };
  }

  private rows(queryResult: unknown): QueryRow[] {
    if (Array.isArray(queryResult) && Array.isArray(queryResult[0])) {
      return queryResult[0] as QueryRow[];
    }
    return Array.isArray(queryResult) ? (queryResult as QueryRow[]) : [];
  }
}
