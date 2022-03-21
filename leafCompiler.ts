import { walkSync } from 'https://deno.land/std@0.85.0/fs/mod.ts';

type FileStorageNumbers = { [path: string]: Array<number> };
type FileStorageTypedArray = { [path: string]: Uint8Array };
type FileSystemConfiguration = { initialized: boolean };

const getFilename = (fullPath: string) => fullPath.replace(/^.*[\\\/]/, '');
const fileSystemPropertyName: string = "MANDARINE_FILE_SYSTEM";
const encoder = new TextEncoder();
const decoderUtf8 = new TextDecoder('utf-8');

const isExecutableFn = () => {
    let result;

    if (Deno.version.deno === '1.13.2') {
        result = Deno.mainModule == 'file://$deno$/bundle.js';
    } else {
        result = Deno.mainModule.indexOf('leaf_') !== -1;
    }

    return result;
}

console.log(`Deno version: ${Deno.version.deno}`)
const isExecutable: boolean = isExecutableFn();
console.log(`Deno Main Module: ${Deno.mainModule}`, `Is executable: ${isExecutable}`);

const fileExists = (path: string | URL): boolean => {
    try {
        Deno.statSync(path);
        return true;
    } catch {
        return false;
    }
}

const getFilePath = (path: string | URL): string => path instanceof URL ? path.toString() : path;

const getFileDirectory = (filePath: string) => {
    if (filePath.indexOf("/") == -1) { // windows
        return filePath.substring(0, filePath.lastIndexOf('\\'));
    }
    else { // unix
        return filePath.substring(0, filePath.lastIndexOf('/'));
    }
}

const guidGenerator = () => {
    let S4 = function () {
        return (((1 + Math.random()) * 0x10000) | 0).toString(16).substring(1);
    };
    return (S4()+S4()+"-"+S4()+"-"+S4()+"-"+S4()+"-"+S4()+S4()+S4());
}

export type CompileOptions = {
    modulePath: string;
    contentFolders: Array<string>;
    flags?: Array<string>;
    output?: string;
    args?: Array<string>;
    compilerOptions?: Deno.CompilerOptions;
}

export class Leaf {

    private static configuration: FileSystemConfiguration = { initialized: false };
    private static files: FileStorageTypedArray = {};

    private static storageToJson(): string {
        const storage: FileStorageNumbers = Object.fromEntries(Object.entries(this.files).map(([filePath, content]) => [filePath, [...content]]));
        return JSON.stringify(storage);
    }

    private static registerOrGetFile(path: string | URL): Uint8Array {
        this.initialize();

        // We don't use in-memory while it's not an executable
        // if (!isExecutable) return Deno.readFileSync(path);

        let filePath = getFilePath(path);

        if(!filePath) throw new Error("Invalid Path");

        const fileInMemory = this.files[filePath] || (this.files[`./${filePath}`] || this.files[filePath.replace("./", "")]);

        // console.log('Files in memory: ' + Object.keys(this.files).join(', '));

        if (!fileInMemory) {
            // Logic for the compiler
            if (fileExists(filePath)) {
                // console.log(`Reading local file: ${filePath}`);
                const fileContent = Deno.readFileSync(filePath);
                this.files[filePath] = fileContent;
                return fileContent;
            } else {
                throw new Error(`File not found (${filePath}).`);
            }
        } else {
            // console.log(`Reading file from memory: ${filePath}`);
            return fileInMemory;
        }
    }

    private static initialize() {
        if (isExecutable && !this.configuration.initialized) {
            //@ts-ignore
            const files = window[fileSystemPropertyName];

            if (files) {
                // @ts-ignore
                this.files = Object.fromEntries(Object.entries(files).map(([filePath, content]) => [filePath, new Uint8Array(content)]));
            }

            this.configuration.initialized = true;

            this.configuration = Object.freeze(this.configuration);
        }
    }

    public static async compile(options: CompileOptions) {
        if (isExecutable) {
            return;
        }

        options.contentFolders.forEach((folder) => {
            for (const entry of Array.from(walkSync(folder)).filter((item) => item.isFile)) {
                this.registerOrGetFile(entry.path);
            }
        });

        const moduleToUse = options.modulePath;
        const [originalFileName] = getFilename(moduleToUse).split(".");
        const tempFilePath = Deno.makeTempFileSync({ prefix: "leaf_", suffix: '.js' });

        const fakeFileSystemString = `\n \n window["${fileSystemPropertyName}"] = ${this.storageToJson()}; \n \n`;
        Deno.writeFileSync(tempFilePath, encoder.encode(fakeFileSystemString), { append: true });

        const compilerOptions = options.compilerOptions ? options.compilerOptions : undefined;

        const bundleCode = (
            await Deno.emit(moduleToUse, {
                bundle: 'module',
                compilerOptions
            })
        ).files['deno:///bundle.js'];
        Deno.writeFileSync(tempFilePath, encoder.encode(bundleCode), { append: true });

        let cmd = ["deno", "compile"];

        if (options && options.flags) {
            if (options.flags.indexOf('--output') !== -1)
                throw new Error("'--output' flag is not valid in the current context. Use the property 'output' instead.");
            if (options.flags.indexOf('--unstable') !== -1)
                options.flags = options.flags.filter((item) => item.toLowerCase() != '--unstable');
            if (options.flags.indexOf('--allow-read') !== -1)
                options.flags = options.flags.filter((item) => item.toLowerCase() != '--allow-read');
            cmd = [...cmd, ...options.flags];
        }

        const outputFilename = (options?.output) ? options?.output : originalFileName;

        const args = options?.args || [];

        cmd = [...cmd, '--unstable', '--allow-read', '--output', outputFilename, tempFilePath.toString(), ...args];

        try {
            const process = Deno.run({
                cmd: cmd
            })
            const status = await process.status();
            console.log(`Compilation results: ${status.success}`);
        } catch (error) {
            error;
        }

        Deno.removeSync(tempFilePath);
    }

    public static readFileSync(path: string | URL): Uint8Array {
        return this.registerOrGetFile(path);
    }

    public static async readFile(path: string | URL): Promise<Uint8Array> {
        return this.readFileSync(path);
    }

    public static readTextFileSync(path: string | URL): string {
        return decoderUtf8.decode(this.readFileSync(path));
    }

    public static async readTextFile(path: string | URL): Promise<string> {
        return this.readTextFileSync(path);
    }

    public static renameSync(oldpath: string | URL, newpath: string | URL): void {
        const fileContent = this.readFileSync(oldpath);

        const newFilePath = getFilePath(newpath);
        this.files[newFilePath] = fileContent;
    }

    public static async rename(oldpath: string | URL, newpath: string | URL): Promise<void> {
        return this.renameSync(oldpath, newpath);
    }

}
