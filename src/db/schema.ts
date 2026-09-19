import { sql } from "drizzle-orm";
import { pgTable, serial, integer, text, timestamp, jsonb, uuid, numeric, uniqueIndex, index, check } from "drizzle-orm/pg-core";

export const courses = pgTable("courses", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  semester: text("semester").notNull(),
  teacher: text("teacher").notNull().default("Елена Смирнова"),
  groupCode: text("group_code").notNull().default("ПИ-24-1"),
  startTime: text("start_time").notNull().default("10:00"),
  endTime: text("end_time").notNull().default("17:30"),
});

export const teams = pgTable("teams", {
  id: serial("id").primaryKey(),
  number: integer("number").notNull().unique(),
  size: integer("size").notNull().default(3),
  members: jsonb("members").$type<{ name: string; contact: string }[]>().notNull().default([]),
  consentAt: timestamp("consent_at", { withTimezone: true }),
  consentIp: text("consent_ip"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [check("team_size_check", sql`${t.size} between 1 and 3`)]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  role: text("role").$type<"student" | "teacher" | "admin">().notNull(),
  teamId: integer("team_id").references(() => teams.id),
});

export const sessions = pgTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const labs = pgTable("labs", {
  id: serial("id").primaryKey(),
  courseId: integer("course_id").notNull().references(() => courses.id),
  number: integer("number").notNull(),
  title: text("title").notNull(),
  theory: text("theory").notNull(),
  practice: text("practice").notNull(),
  questions: text("questions").notNull(),
  deadline: timestamp("deadline", { withTimezone: true }).notNull(),
}, (t) => [uniqueIndex("lab_course_number_unique").on(t.courseId, t.number)]);

export const progress = pgTable("lab_progress", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id").notNull().references(() => teams.id),
  labId: integer("lab_id").notNull().references(() => labs.id),
  status: text("status").$type<"new" | "in_progress" | "review" | "revision" | "completed">().notNull().default("new"),
  score: numeric("score"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("team_lab_progress_unique").on(t.teamId, t.labId)]);

export const bookings = pgTable("bookings", {
  id: uuid("id").defaultRandom().primaryKey(),
  teamId: integer("team_id").notNull().references(() => teams.id),
  labId: integer("lab_id").notNull().references(() => labs.id),
  startAt: timestamp("start_at", { withTimezone: true }).notNull(),
  purpose: text("purpose").$type<"defense" | "consultation">().notNull(),
  status: text("status").$type<"pending" | "confirmed" | "revision" | "rejected" | "cancelled" | "no_show" | "completed">().notNull().default("pending"),
  comment: text("comment").notNull().default(""),
  teacherComment: text("teacher_comment").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("occupied_slot_unique").on(t.startAt).where(sql`${t.status} in ('pending', 'confirmed', 'revision', 'completed')`),
  index("booking_team_index").on(t.teamId),
]);

export const files = pgTable("lab_files", {
  id: uuid("id").defaultRandom().primaryKey(),
  teamId: integer("team_id").notNull().references(() => teams.id),
  labId: integer("lab_id").notNull().references(() => labs.id),
  version: integer("version").notNull(),
  name: text("name").notNull(),
  size: integer("size").notNull(),
  data: text("data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("file_version_unique").on(t.teamId, t.labId, t.version)]);

export const history = pgTable("action_history", {
  id: uuid("id").defaultRandom().primaryKey(),
  teamId: integer("team_id").notNull().references(() => teams.id),
  labId: integer("lab_id").references(() => labs.id),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  detail: text("detail").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("history_team_lab_index").on(t.teamId, t.labId)]);
