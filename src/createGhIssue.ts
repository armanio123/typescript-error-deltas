import fs = require("fs");
import path = require("path");
import { Metadata, metadataFileName, RepoStatus, resultFileNameSuffix, StatusCounts } from "./main";
import git = require("./gitUtils");
import pu = require("./packageUtils");

const { argv } = process;

if (argv.length !== 7) {
    console.error(`Usage: ${path.basename(argv[0])} ${path.basename(argv[1])} <repo_count> <repo_start_index> <result_dir_path> <log_uri> <post_result>`);
    process.exit(-1);
}

const [,, repoCount, repoStartIndex, resultDirPath, logUri, post] = argv;
const postResult = post.toLowerCase() === "true";

const metadataFilePaths = pu.glob(resultDirPath, `**/${metadataFileName}`);

let analyzedCount = 0;
let totalCount = 0;
const statusCounts: StatusCounts = {};

let newTscResolvedVersion: string | undefined;
let oldTscResolvedVersion: string | undefined;

for (const path of metadataFilePaths) {
    const metadata: Metadata = JSON.parse(fs.readFileSync(path, { encoding: "utf-8" }));

    newTscResolvedVersion ??= metadata.newTscResolvedVersion;
    oldTscResolvedVersion ??= metadata.oldTscResolvedVersion;

    for (const s in metadata.statusCounts) {
        const status = s as RepoStatus;
        const count = metadata.statusCounts[status]!;
        statusCounts[status] = (statusCounts[status] ?? 0) + count;
        totalCount += count;
        switch (status) {
            case "Detected no interesting changes":
            case "Detected interesting changes":
                analyzedCount += count;
                break;
        }
    }
}

const title = `[NewErrors] ${newTscResolvedVersion} vs ${oldTscResolvedVersion}`;
const header = `The following errors were reported by ${newTscResolvedVersion}, but not by ${oldTscResolvedVersion}
[Pipeline that generated this bug](https://typescript.visualstudio.com/TypeScript/_build?definitionId=48)
[Logs for the pipeline run](${logUri})
[File that generated the pipeline](https://github.com/microsoft/typescript-error-deltas/blob/main/azure-pipelines-gitTests.yml)

This run considered ${repoCount} popular TS repos from GH (after skipping the top ${repoStartIndex}).

<details>
<summary>Successfully analyzed ${analyzedCount} of ${totalCount} visited repos</summary>

| Outcome | Count |
|---------|-------|
${Object.keys(statusCounts).sort().map(status => `| ${status} | ${statusCounts[status as RepoStatus]} |\n`).join("")}
</details>


`;

const resultPaths = pu.glob(resultDirPath, `**/*.${resultFileNameSuffix}`).sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
const outputs = resultPaths.map(p => fs.readFileSync(p, { encoding: "utf-8" }));


// GH caps the maximum body length, so paginate if necessary
const bodyChunks: string[] = [];
let chunk = header;
for (const output of outputs) {
    if (chunk.length + output.length > 65536) {
        bodyChunks.push(chunk);
        chunk = "";
    }
    chunk += output;
}
bodyChunks.push(chunk);

git.createIssue(postResult, title, bodyChunks, /*sawNewErrors*/ !!outputs.length);