import fs from 'fs';
import path from 'path';

function walk(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      walk(fullPath);
    } else if (fullPath.endsWith('.js')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      // match import and export from relative paths
      content = content.replace(/(import|export) (.*?) from ['"](\..*?)['"]/g, (match, p1, p2, p3) => {
        if (!p3.endsWith('.js')) {
          // Check if the target is a directory (meaning it imports index.js)
          const targetDir = path.resolve(dir, p3);
          let append = '.js';
          if (fs.existsSync(targetDir) && fs.statSync(targetDir).isDirectory()) {
            append = '/index.js';
          }
          return `${p1} ${p2} from '${p3}${append}'`;
        }
        return match;
      });
      
      // Also match import '...';
      content = content.replace(/import ['"](\..*?)['"]/g, (match, p1) => {
        if (!p1.endsWith('.js')) {
          const targetDir = path.resolve(dir, p1);
          let append = '.js';
          if (fs.existsSync(targetDir) && fs.statSync(targetDir).isDirectory()) {
            append = '/index.js';
          }
          return `import '${p1}${append}'`;
        }
        return match;
      });
      
      // Fix dayjs plugins
      content = content.replace(/from ['"]dayjs\/plugin\/(.*?)['"]/g, (match, plugin) => {
         if (!plugin.endsWith('.js')) {
            return `from 'dayjs/plugin/${plugin}.js'`;
         }
         return match;
      });

      fs.writeFileSync(fullPath, content);
    }
  }
}
walk('/Users/ravikumar/Desktop/stock-analyzer/server/node_modules/growwapi/dist');
