const electronInstaller = require('electron-winstaller');
const path = require('path');

async function buildInstaller() {
  try {
    console.log('Building windows installer...');
    await electronInstaller.createWindowsInstaller({
      appDirectory: path.join(__dirname, 'release', 'DotsStrategy-win32-x64'),
      outputDirectory: path.join(__dirname, 'release', 'installer'),
      authors: 'BABYLON.IA',
      exe: 'DotsStrategy.exe',
      setupExe: 'DotsStrategy_Setup.exe',
      description: 'Dots Strategy AA Experience',
      noMsi: true, // Use simpler setup
      setupIcon: path.join(__dirname, 'build', 'icon.ico')
    });
    console.log('Installer successfully built at release/installer/DotsStrategy_Setup.exe!');
  } catch (e) {
    console.log(`Error making installer: ${e.message}`);
  }
}

buildInstaller();