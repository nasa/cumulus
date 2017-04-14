# GIBS Dashboard

A dashboard for operating GIBS running in AWS.

## Build

```Bash
nvm use
npm install
npm run production
```

The code is compiled into static assets in `dist`.

## Running Locally

```Bash
nvm use
npm install
npm start
```

After running this the website will load in your browser. The website will automatically load on changes.

## Deploy

Run the following command with the stack name to use. (Suggested name is your first two initials + `-gibs-dashboard`)

`bin/deploy.sh my-stack-name`
