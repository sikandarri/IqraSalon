import {sqliteTable,text,integer,index,primaryKey} from 'drizzle-orm/sqlite-core';
export const records=sqliteTable('records',{kind:text('kind').notNull(),id:text('id').notNull(),data:text('data').notNull(),updatedAt:text('updated_at').notNull()},t=>[primaryKey({columns:[t.kind,t.id]}),index('records_kind_updated').on(t.kind,t.updatedAt)]);
export const limits=sqliteTable('rate_limits',{key:text('key').primaryKey(),count:integer('count').notNull(),expires:integer('expires').notNull()},t=>[index('rate_limits_expires').on(t.expires)]);
