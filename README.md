# ganesh-utsav-backend

## Deploy on Render

This repository includes a `render.yaml` Blueprint for deploying the API as a Render Web Service.

1. Push this repository to GitHub.
2. In Render, select **New > Blueprint** and connect the repository.
3. Keep the service root as the repository root and use the generated service `ganesh-utsav-api`.
4. When prompted, set:
   - `ADMIN_PASSWORD`: the password used by the admin login.
   - `CLIENT_ORIGIN`: the deployed frontend URL, or leave it empty while testing.
   - `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`: values from an Upstash Redis database.
5. Deploy the Blueprint. Render automatically supplies `PORT`, runs `npm ci`, and starts the API with `npm start`.

Upstash Redis is recommended because Render's local filesystem is ephemeral. Without the Redis variables, board updates fall back to `data/board.json` and can be lost after a redeploy or restart.
