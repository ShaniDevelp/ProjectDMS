CREATE TABLE "attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"doc_kind" text NOT NULL,
	"doc_id" integer NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "attachments_doc_idx" ON "attachments" USING btree ("doc_kind","doc_id");