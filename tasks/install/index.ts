import * as path from 'path';
import * as os from 'os';
import * as bent from 'bent';
import * as task from "azure-pipelines-task-lib";
import * as tool from 'azure-pipelines-tool-lib/tool';

const getJSON = bent('json')

const FLUTTER_TOOL_NAME: string = 'Flutter';
const FLUTTER_EXE_RELATIVEPATH = 'flutter/bin';
const FLUTTER_TOOL_PATH_ENV_VAR: string = 'FlutterToolPath';

async function main(): Promise<void> {
	// 1. Getting current platform identifier
	let arch = findArchitecture();

	// 2. Building version spec
	let channel = task.getInput('channel', true);
	var version = task.getInput('version', true);
	if (version === 'custom') {
		version = task.getInput('customVersion', true);
	}

	let sdkInfo = await findSdkInformation(channel, arch, version);

	// 3. Check if already available
	task.debug(`Trying to get (${FLUTTER_TOOL_NAME},${sdkInfo.version}, ${arch}) tool from local cache`);
	let toolPath = tool.findLocalTool(FLUTTER_TOOL_NAME, sdkInfo.version, arch);

	if (!toolPath) {
		// 4.1. Downloading SDK
		await downloadAndCacheSdk(sdkInfo, channel, arch);

		// 4.2. Verifying that tool is now available
		task.debug(`Trying again to get (${FLUTTER_TOOL_NAME},${sdkInfo.version}, ${arch}) tool from local cache`);
		toolPath = tool.findLocalTool(FLUTTER_TOOL_NAME, sdkInfo.version, arch);
	}

	if (toolPath) {
		// 5. Creating the environment variable
		let fullFlutterPath: string = path.join(toolPath, FLUTTER_EXE_RELATIVEPATH);
		task.debug(`Set ${FLUTTER_TOOL_PATH_ENV_VAR} with '${fullFlutterPath}'`);
		task.setVariable(FLUTTER_TOOL_PATH_ENV_VAR, fullFlutterPath);
		task.setResult(task.TaskResult.Succeeded, "Installed");
	}
	else {
		task.setResult(task.TaskResult.Failed, "Download succedeeded but ToolPath not found.");
	}
}

function findArchitecture() {
	if (os.platform() === 'darwin')
		return "macos";
	else if (os.platform() === 'linux')
		return "linux";
	return "windows";
}

async function findSdkInformation(channel: string, arch: string, version: string): Promise<{ downloadUrl: string, version: string }> {
	let releasesUrl = `https://storage.googleapis.com/flutter_infra/releases/releases_${arch}.json`;
	let json = await getJSON(releasesUrl);
	var current = null;
	if (version === 'latest') {
		let currentHash = json.current_release[channel];
		current = json.releases.find((item: { hash: any; }) => item.hash === currentHash);
	}
	else {
		current = json.releases.find((item: { version: any; }) => item.version === version);
	}

	if (current.version.startsWith('v')) {
		current.version = current.version.substring(1);
	}

	return {
		version: current.version + '-' + channel,
		downloadUrl: json.base_url + '/' + current.archive,
	};
}

async function downloadAndCacheSdk(sdkInfo: { downloadUrl: string, version: string }, channel: string, arch: string): Promise<void> {
	// 1. Download SDK archive
	task.debug(`Starting download archive from '${sdkInfo.downloadUrl}'`);
	var bundleZip = await tool.downloadTool(sdkInfo.downloadUrl);
	task.debug(`Succeeded to download '${bundleZip}' archive from '${sdkInfo.downloadUrl}'`);

	// 2. Extracting SDK bundle
	task.debug(`Extracting '${sdkInfo.downloadUrl}' archive`);
	var bundleDir = await tool.extractZip(bundleZip);
	task.debug(`Extracted to '${bundleDir}' '${sdkInfo.downloadUrl}' archive`);

	// 3. Adding SDK bundle to cache
	task.debug(`Adding '${bundleDir}' to cache (${FLUTTER_TOOL_NAME},${sdkInfo.version}, ${arch})`);
	tool.cacheDir(bundleDir, FLUTTER_TOOL_NAME, sdkInfo.version, arch);
}

main().catch(error => {
	task.setResult(task.TaskResult.Failed, error);
});