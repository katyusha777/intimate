ALTER TYPE "public"."meeting_type" ADD VALUE 'virtual';--> statement-breakpoint
ALTER TABLE "orgs" ALTER COLUMN "city" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "city" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."city";--> statement-breakpoint
CREATE TYPE "public"."city" AS ENUM('amsterdam', 'rotterdam', 'den-haag', 'utrecht', 'eindhoven', 'groningen', 'tilburg', 'almere', 'breda', 'nijmegen', 'apeldoorn', 'haarlem', 'arnhem', 'enschede', 'amersfoort', 'zaanstad', 'den-bosch', 'zwolle', 'leiden', 'maastricht', 'dordrecht', 'ede', 'alphen-aan-den-rijn', 'alkmaar', 'emmen', 'delft', 'venlo', 'deventer', 'leeuwarden', 'heerlen', 'online');--> statement-breakpoint
ALTER TABLE "orgs" ALTER COLUMN "city" SET DATA TYPE "public"."city" USING "city"::"public"."city";--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "city" SET DATA TYPE "public"."city" USING "city"::"public"."city";--> statement-breakpoint
UPDATE "profiles" SET "city" = 'amsterdam' WHERE "city" = 'online';
