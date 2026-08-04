/*
  Warnings:

  - The primary key for the `idempotency_records` table will be changed. If it partially fails, the table could be left without primary key constraint.

*/
-- AlterTable
ALTER TABLE "idempotency_records" DROP CONSTRAINT "idempotency_records_pkey",
ADD CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("org_id", "key");
