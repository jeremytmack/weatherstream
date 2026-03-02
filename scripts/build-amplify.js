const fs = require('fs');
const path = require('path');

const rootPath = path.join(__dirname, '..');
const amplifyDir = path.join(rootPath, '.amplify-hosting');
const computeDir = path.join(amplifyDir, 'compute', 'default');
const staticDir = path.join(amplifyDir, 'static');

// Clean and create dirs
fs.rmSync(amplifyDir, { force: true, recursive: true });
fs.mkdirSync(computeDir, { recursive: true });
fs.mkdirSync(staticDir, { recursive: true });

// Copy dist to static
if (fs.existsSync(path.join(rootPath, 'dist'))) {
    fs.cpSync(path.join(rootPath, 'dist'), staticDir, { recursive: true });
} else {
    console.error("Dist folder not found! Build the frontend first.");
    process.exit(1);
}

// Copy server.js
fs.copyFileSync(path.join(rootPath, 'server.js'), path.join(computeDir, 'server.js'));

// Write deploy-manifest.json
const manifest = {
    version: 1,
    routes: [
        {
            path: "/api/*",
            target: {
                kind: "Compute",
                src: "default"
            }
        },
        {
            path: "/*",
            fallback: {
                kind: "Compute",
                src: "default"
            },
            target: {
                kind: "Static"
            }
        }
    ],
    computeResources: [
        {
            name: "default",
            entrypoint: "server.js",
            runtime: "nodejs18.x"
        }
    ]
};

fs.writeFileSync(path.join(amplifyDir, 'deploy-manifest.json'), JSON.stringify(manifest, null, 2));

// Prepare minimal package.json for the compute function
const rootPkg = JSON.parse(fs.readFileSync(path.join(rootPath, 'package.json'), 'utf-8'));
const computePkg = {
    name: "amplify-compute",
    version: "1.0.0",
    type: "commonjs",
    dependencies: {
        "express": rootPkg.dependencies.express || "^4.18.2",
        "cors": rootPkg.dependencies.cors || "^2.8.5",
        "node-fetch": rootPkg.dependencies["node-fetch"] || "^2.7.0",
        "dotenv": rootPkg.dependencies.dotenv || "^16.3.1"
    }
};

fs.writeFileSync(path.join(computeDir, 'package.json'), JSON.stringify(computePkg, null, 2));

console.log('AWS Amplify Hosting SSR structure generated successfully.');
