# ELS-Server

EL's beauty studio api

## Studio media uploads

All media UI flows use the shared multipart endpoints at /api/uploads/multipart/*. The API authenticates the user, binds the S3 key to the resolved studio, and hands the browser short-lived presigned part URLs. File bytes go from the browser directly to S3 in 10 MiB chunks; after S3 confirms completion, the API returns a CloudFront delivery URL. Gallery, service, product, studio branding, profile, and appointment reference uploads use their own studios/<studioId>/<category>/ prefixes. Gallery video entries can instead store HTTPS YouTube or TikTok links; those render in provider embeds and are not copied into S3.

Set AWS_CLOUDFRONT_URL in Render to the distribution hostname, with no trailing slash (for example https://d1234567890abc.cloudfront.net). Keep the bucket private and configure CloudFront Origin Access Control to read from that bucket. The API rewrites existing virtual-hosted S3 URLs in gallery, service, product, studio branding, profile, and appointment responses to the matching CloudFront URL, so existing object keys remain usable. Existing files must still exist in the bucket and be readable by the CloudFront origin identity.

Configure the S3 bucket CORS policy so the browser can PUT parts and read their ETags. This app supports studio custom domains, so S3 CORS must allow any origin; the presigned part URLs are the authorization, and CORS alone does not grant S3 access:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedOrigins": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

The CORS wildcard is required for custom studio domains. S3 still rejects requests without a valid, short-lived presigned part URL.

Grant the API's AWS identity S3 s3:PutObject and s3:AbortMultipartUpload access to the bucket's studios/* keys. Add an S3 lifecycle rule to abort incomplete multipart uploads after one day so abandoned browser uploads do not retain billable parts. The CloudFront distribution should allow byte-range GET/HEAD requests and cache video objects; the bucket policy should permit reads only from the distribution's Origin Access Control.

The API caps a gallery upload at 2 GiB and gives part URLs a one-hour lifetime. If you use a custom CloudFront domain instead of the distribution's cloudfront.net hostname, add that host to the Vercel Content-Security-Policy image and media source lists. Images and uploaded videos both use CloudFront URLs; external provider videos remain provider URLs.
