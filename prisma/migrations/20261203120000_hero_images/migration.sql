-- Up to 5 photos for the carousel at the top of a studio or store website.
ALTER TABLE "studio_content" ADD COLUMN "heroImages" TEXT[] DEFAULT ARRAY[]::TEXT[];
