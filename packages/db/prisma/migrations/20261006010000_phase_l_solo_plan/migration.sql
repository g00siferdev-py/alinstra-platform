-- Phase L: Solo plan for marketing + self-serve; lead plan interest from /start?plan=.

INSERT INTO "plan" ("id","code","name","monthlyPriceCents","includedMinutes","overagePerMinuteCents","setupFeeCents","includedChangesPerMonth","extraChangeFeeCents","recallMonthlyCents","recallPerBookingCents","active","sortOrder","createdAt","updatedAt")
VALUES ('plan_solo','solo','Solo',9900,150,40,9900,1,4900,2500,600,true,0,NOW(),NOW())
ON CONFLICT ("code") DO NOTHING;

ALTER TABLE "lead" ADD COLUMN IF NOT EXISTS "planInterest" TEXT;
