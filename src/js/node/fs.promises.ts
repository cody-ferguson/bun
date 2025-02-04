// Hardcoded module "node:fs/promises"
import type { Dirent } from "fs";
const EventEmitter = require("node:events");
const fs = $zig("node_fs_binding.zig", "createBinding");
const constants = $processBindingConstants.fs;

var PromisePrototypeFinally = Promise.prototype.finally; //TODO
var SymbolAsyncDispose = Symbol.asyncDispose;
var ObjectFreeze = Object.freeze;

const kFd = Symbol("kFd");
const kRefs = Symbol("kRefs");
const kClosePromise = Symbol("kClosePromise");
const kCloseResolve = Symbol("kCloseResolve");
const kCloseReject = Symbol("kCloseReject");
const kRef = Symbol("kRef");
const kUnref = Symbol("kUnref");
const kTransfer = Symbol("kTransfer");
const kTransferList = Symbol("kTransferList");
const kDeserialize = Symbol("kDeserialize");
const kEmptyObject = ObjectFreeze({ __proto__: null });
const kFlag = Symbol("kFlag");

const { validateObject } = require("internal/validators");

function watch(
  filename: string | Buffer | URL,
  options: { encoding?: BufferEncoding; persistent?: boolean; recursive?: boolean; signal?: AbortSignal } = {},
) {
  type Event = {
    eventType: string;
    filename: string | Buffer | undefined;
  };

  if (filename instanceof URL) {
    throw new TypeError("Watch URLs are not supported yet");
  } else if (Buffer.isBuffer(filename)) {
    filename = filename.toString();
  } else if (typeof filename !== "string") {
    throw $ERR_INVALID_ARG_TYPE("filename", ["string", "Buffer", "URL"], filename);
  }
  let nextEventResolve: Function | null = null;
  if (typeof options === "string") {
    options = { encoding: options };
  }
  const queue = $createFIFO();

  const watcher = fs.watch(filename, options || {}, (eventType: string, filename: string | Buffer | undefined) => {
    queue.push({ eventType, filename });
    if (nextEventResolve) {
      const resolve = nextEventResolve;
      nextEventResolve = null;
      resolve();
    }
  });

  return {
    [Symbol.asyncIterator]() {
      let closed = false;
      return {
        async next() {
          while (!closed) {
            let event: Event;
            while ((event = queue.shift() as Event)) {
              if (event.eventType === "close") {
                closed = true;
                return { value: undefined, done: true };
              }
              if (event.eventType === "error") {
                closed = true;
                throw event.filename;
              }
              return { value: event, done: false };
            }
            const { promise, resolve } = Promise.withResolvers();
            nextEventResolve = resolve;
            await promise;
          }
          return { value: undefined, done: true };
        },

        return() {
          if (!closed) {
            watcher.close();
            closed = true;
            if (nextEventResolve) {
              const resolve = nextEventResolve;
              nextEventResolve = null;
              resolve();
            }
          }
          return { value: undefined, done: true };
        },
      };
    },
  };
}

// attempt to use the native code version if possible
// and on MacOS, simple cases of recursive directory trees can be done in a single `clonefile()`
// using filter and other options uses a lazily loaded js fallback ported from node.js
function cp(src, dest, options) {
  if (!options) return fs.cp(src, dest);
  if (typeof options !== "object") {
    throw new TypeError("options must be an object");
  }
  if (options.dereference || options.filter || options.preserveTimestamps || options.verbatimSymlinks) {
    return require("../internal/fs/cp")(src, dest, options);
  }
  return fs.cp(src, dest, options.recursive, options.errorOnExist, options.force ?? true, options.mode);
}

// TODO: implement this in native code using a Dir Iterator 💀
// This is currently stubbed for Next.js support.
class Dir {
  #entries: Dirent[];
  #path: string;
  constructor(e: Dirent[], path: string) {
    this.#entries = e;
    this.#path = path;
  }
  get path() {
    return this.#path;
  }
  readSync() {
    return this.#entries.shift() ?? null;
  }
  read(c) {
    if (c) process.nextTick(c, null, this.readSync());
    return Promise.resolve(this.readSync());
  }
  closeSync() {}
  close(c) {
    if (c) process.nextTick(c);
    return Promise.resolve();
  }
  *[Symbol.asyncIterator]() {
    var next;
    while ((next = this.readSync())) {
      yield next;
    }
  }
}

async function opendir(dir: string) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return new Dir(entries, dir);
}

const private_symbols = {
  kRef,
  kUnref,
  kFd,
  FileHandle: null as any,
  fs,
};

const _readFile = fs.readFile.bind(fs);
const _writeFile = fs.writeFile.bind(fs);
const _appendFile = fs.appendFile.bind(fs);

const exports = {
  access: asyncWrap(fs.access, "access"),
  appendFile: async function (fileHandleOrFdOrPath, ...args) {
    fileHandleOrFdOrPath = fileHandleOrFdOrPath?.[kFd] ?? fileHandleOrFdOrPath;
    return _appendFile(fileHandleOrFdOrPath, ...args);
  },
  close: asyncWrap(fs.close, "close"),
  copyFile: asyncWrap(fs.copyFile, "copyFile"),
  cp,
  exists: async function exists() {
    try {
      return await fs.exists.$apply(fs, arguments);
    } catch (e) {
      return false;
    }
  },
  chown: asyncWrap(fs.chown, "chown"),
  chmod: asyncWrap(fs.chmod, "chmod"),
  fchmod: asyncWrap(fs.fchmod, "fchmod"),
  fchown: asyncWrap(fs.fchown, "fchown"),
  fstat: asyncWrap(fs.fstat, "fstat"),
  fsync: asyncWrap(fs.fsync, "fsync"),
  fdatasync: asyncWrap(fs.fdatasync, "fdatasync"),
  ftruncate: asyncWrap(fs.ftruncate, "ftruncate"),
  futimes: asyncWrap(fs.futimes, "futimes"),
  lchmod: asyncWrap(fs.lchmod, "lchmod"),
  lchown: asyncWrap(fs.lchown, "lchown"),
  link: asyncWrap(fs.link, "link"),
  lstat: asyncWrap(fs.lstat, "lstat"),
  mkdir: asyncWrap(fs.mkdir, "mkdir"),
  mkdtemp: asyncWrap(fs.mkdtemp, "mkdtemp"),
  statfs: asyncWrap(fs.statfs, "statfs"),
  open: async (path, flags = "r", mode = 0o666) => {
    return new FileHandle(await fs.open(path, flags, mode), flags);
  },
  read: asyncWrap(fs.read, "read"),
  write: asyncWrap(fs.write, "write"),
  readdir: asyncWrap(fs.readdir, "readdir"),
  readFile: function (fileHandleOrFdOrPath, ...args) {
    fileHandleOrFdOrPath = fileHandleOrFdOrPath?.[kFd] ?? fileHandleOrFdOrPath;
    return _readFile(fileHandleOrFdOrPath, ...args);
  },
  writeFile: function (fileHandleOrFdOrPath, ...args: any[]) {
    fileHandleOrFdOrPath = fileHandleOrFdOrPath?.[kFd] ?? fileHandleOrFdOrPath;
    if (
      !$isTypedArrayView(args[0]) &&
      typeof args[0] !== "string" &&
      ($isCallable(args[0]?.[Symbol.iterator]) || $isCallable(args[0]?.[Symbol.asyncIterator]))
    ) {
      $debug("fs.promises.writeFile async iterator slow path!");
      // Node accepts an arbitrary async iterator here
      // @ts-expect-error TODO
      return writeFileAsyncIterator(fileHandleOrFdOrPath, ...args);
    }
    return _writeFile(fileHandleOrFdOrPath, ...args);
  },
  readlink: asyncWrap(fs.readlink, "readlink"),
  realpath: asyncWrap(fs.realpath, "realpath"),
  rename: asyncWrap(fs.rename, "rename"),
  stat: asyncWrap(fs.stat, "stat"),
  symlink: asyncWrap(fs.symlink, "symlink"),
  truncate: asyncWrap(fs.truncate, "truncate"),
  unlink: asyncWrap(fs.unlink, "unlink"),
  utimes: asyncWrap(fs.utimes, "utimes"),
  lutimes: asyncWrap(fs.lutimes, "lutimes"),
  rm: asyncWrap(fs.rm, "rm"),
  rmdir: asyncWrap(fs.rmdir, "rmdir"),
  writev: async (fd, buffers, position) => {
    var bytesWritten = await fs.writev(fd, buffers, position);
    return {
      bytesWritten,
      buffers,
    };
  },
  readv: async (fd, buffers, position) => {
    var bytesRead = await fs.readv(fd, buffers, position);

    return {
      bytesRead,
      buffers,
    };
  },
  constants,
  watch,
  opendir,

  // "$data" is reuse of private symbol
  // this is used to export the private symbols to 'fs.js' without making it public.
  $data: private_symbols,
};
export default exports;

function asyncWrap(fn: any, name: string) {
  const wrapped = async function (...args) {
    return fn.$apply(fs, args);
  };
  Object.defineProperty(wrapped, "name", { value: name });
  Object.defineProperty(wrapped, "length", { value: fn.length });
  return wrapped;
}

{
  const {
    writeFile,
    readFile,
    fchmod,
    fchown,
    fdatasync,
    fsync,
    read,
    readv,
    fstat,
    ftruncate,
    futimes,
    write,
    writev,
    close,
  } = exports;
  let isArrayBufferView;

  // Partially taken from https://github.com/nodejs/node/blob/c25878d370/lib/internal/fs/promises.js#L148
  // These functions await the result so that errors propagate correctly with
  // async stack traces and so that the ref counting is correct.
  var FileHandle = (private_symbols.FileHandle = class FileHandle extends EventEmitter {
    constructor(fd, flag) {
      super();
      this[kFd] = fd ? fd : -1;
      this[kRefs] = 1;
      this[kClosePromise] = null;
      this[kFlag] = flag;
    }

    getAsyncId() {
      throw new Error("BUN TODO FileHandle.getAsyncId");
    }

    get fd() {
      return this[kFd];
    }

    [kCloseResolve];
    [kFd];
    [kFlag];
    [kClosePromise];
    [kRefs];

    async appendFile(data, options) {
      const fd = this[kFd];
      throwEBADFIfNecessary("writeFile", fd);
      let encoding = "utf8";
      let flush = false;

      if (options == null || typeof options === "function") {
      } else if (typeof options === "string") {
        encoding = options;
      } else {
        encoding = options?.encoding ?? encoding;
        flush = options?.flush ?? flush;
      }

      try {
        this[kRef]();
        return await writeFile(fd, data, { encoding, flush, flag: this[kFlag] });
      } finally {
        this[kUnref]();
      }
    }

    async chmod(mode) {
      const fd = this[kFd];
      throwEBADFIfNecessary("fchmod", fd);

      try {
        this[kRef]();
        return await fchmod(fd, mode);
      } finally {
        this[kUnref]();
      }
    }

    async chown(uid, gid) {
      const fd = this[kFd];
      throwEBADFIfNecessary("fchown", fd);

      try {
        this[kRef]();
        return await fchown(fd, uid, gid);
      } finally {
        this[kUnref]();
      }
    }

    async datasync() {
      const fd = this[kFd];
      throwEBADFIfNecessary("fdatasync", fd);

      try {
        this[kRef]();
        return await fdatasync(fd);
      } finally {
        this[kUnref]();
      }
    }

    async sync() {
      const fd = this[kFd];
      throwEBADFIfNecessary("fsync", fd);

      try {
        this[kRef]();
        return await fsync(fd);
      } finally {
        this[kUnref]();
      }
    }

    async read(buffer, offset, length, position) {
      const fd = this[kFd];
      throwEBADFIfNecessary("read", fd);

      isArrayBufferView ??= require("node:util/types").isArrayBufferView;
      if (!isArrayBufferView(buffer)) {
        // This is fh.read(params)
        if (buffer != undefined) {
          validateObject(buffer, "options");
        }
        ({ buffer = Buffer.alloc(16384), offset = 0, length, position = null } = buffer ?? {});
      }
      length = length ?? buffer?.byteLength - offset;

      if (length === 0) {
        return { buffer, bytesRead: 0 };
      }

      try {
        this[kRef]();
        return { buffer, bytesRead: await read(fd, buffer, offset, length, position) };
      } finally {
        this[kUnref]();
      }
    }

    async readv(buffers, position) {
      const fd = this[kFd];
      throwEBADFIfNecessary("readv", fd);

      try {
        this[kRef]();
        return await readv(fd, buffers, position);
      } finally {
        this[kUnref]();
      }
    }

    async readFile(options) {
      const fd = this[kFd];
      throwEBADFIfNecessary("readFile", fd);

      try {
        this[kRef]();
        return await readFile(fd, options);
      } finally {
        this[kUnref]();
      }
    }

    readLines(options = undefined) {
      throw new Error("BUN TODO FileHandle.readLines");
    }

    async stat(options) {
      const fd = this[kFd];
      throwEBADFIfNecessary("fstat", fd);

      try {
        this[kRef]();
        return await fstat(fd, options);
      } finally {
        this[kUnref]();
      }
    }

    async truncate(len = 0) {
      const fd = this[kFd];
      throwEBADFIfNecessary("ftruncate", fd);

      try {
        this[kRef]();
        return await ftruncate(fd, len);
      } finally {
        this[kUnref]();
      }
    }

    async utimes(atime, mtime) {
      const fd = this[kFd];
      throwEBADFIfNecessary("futimes", fd);

      try {
        this[kRef]();
        return await futimes(fd, atime, mtime);
      } finally {
        this[kUnref]();
      }
    }

    async write(buffer, offset, length, position) {
      const fd = this[kFd];
      throwEBADFIfNecessary("write", fd);

      if (buffer?.byteLength === 0) return { __proto__: null, bytesWritten: 0, buffer };

      isArrayBufferView ??= require("node:util/types").isArrayBufferView;
      if (isArrayBufferView(buffer)) {
        if (typeof offset === "object") {
          ({ offset = 0, length = buffer.byteLength - offset, position = null } = offset ?? kEmptyObject);
        }

        if (offset == null) {
          offset = 0;
        }
        if (typeof length !== "number") length = buffer.byteLength - offset;
        if (typeof position !== "number") position = null;
      }
      try {
        this[kRef]();
        return { buffer, bytesWritten: await write(fd, buffer, offset, length, position) };
      } finally {
        this[kUnref]();
      }
    }

    async writev(buffers, position) {
      const fd = this[kFd];
      throwEBADFIfNecessary("writev", fd);

      try {
        this[kRef]();
        return await writev(fd, buffers, position);
      } finally {
        this[kUnref]();
      }
    }

    async writeFile(data: string, options: any = "utf8") {
      const fd = this[kFd];
      throwEBADFIfNecessary("writeFile", fd);
      let encoding: string = "utf8";

      if (options == null || typeof options === "function") {
      } else if (typeof options === "string") {
        encoding = options;
      } else {
        encoding = options?.encoding ?? encoding;
      }

      try {
        this[kRef]();
        return await writeFile(fd, data, { encoding, flag: this[kFlag] });
      } finally {
        this[kUnref]();
      }
    }

    close = () => {
      const fd = this[kFd];
      if (fd === -1) {
        return Promise.resolve();
      }

      if (this[kClosePromise]) {
        return this[kClosePromise];
      }

      if (--this[kRefs] === 0) {
        this[kFd] = -1;
        this[kClosePromise] = PromisePrototypeFinally.$call(close(fd), () => {
          this[kClosePromise] = undefined;
        });
      } else {
        this[kClosePromise] = PromisePrototypeFinally.$call(
          new Promise((resolve, reject) => {
            this[kCloseResolve] = resolve;
            this[kCloseReject] = reject;
          }),
          () => {
            this[kClosePromise] = undefined;
            this[kCloseReject] = undefined;
            this[kCloseResolve] = undefined;
          },
        );
      }

      this.emit("close");
      return this[kClosePromise];
    };

    async [SymbolAsyncDispose]() {
      return this.close();
    }

    readableWebStream(options = kEmptyObject) {
      const fd = this[kFd];
      throwEBADFIfNecessary("fs".createReadStream, fd);

      return Bun.file(fd).stream();
    }

    createReadStream(options = kEmptyObject) {
      const fd = this[kFd];
      throwEBADFIfNecessary("fs".createReadStream, fd);
      return require("node:fs").createReadStream("", {
        fd: this,
        highWaterMark: 64 * 1024,
        ...options,
      });
    }

    createWriteStream(options = kEmptyObject) {
      const fd = this[kFd];
      throwEBADFIfNecessary("fs".createWriteStream, fd);
      return require("node:fs").createWriteStream("", {
        fd: this,
        ...options,
      });
    }

    [kTransfer]() {
      throw new Error("BUN TODO FileHandle.kTransfer");
    }

    [kTransferList]() {
      throw new Error("BUN TODO FileHandle.kTransferList");
    }

    [kDeserialize]({ handle }) {
      throw new Error("BUN TODO FileHandle.kDeserialize");
    }

    [kRef]() {
      this[kRefs]++;
    }

    [kUnref]() {
      if (--this[kRefs] === 0) {
        this[kFd] = -1;
        this.close().$then(this[kCloseResolve], this[kCloseReject]);
      }
    }
  });
}

function throwEBADFIfNecessary(fn: string, fd) {
  if (fd === -1) {
    const err: any = new Error("Bad file descriptor");
    err.code = "EBADF";
    err.name = "SystemError";
    err.syscall = fn;
    throw err;
  }
}

async function writeFileAsyncIteratorInner(fd, iterable, encoding) {
  const writer = Bun.file(fd).writer();

  const mustRencode = !(encoding === "utf8" || encoding === "utf-8" || encoding === "binary" || encoding === "buffer");
  let totalBytesWritten = 0;

  try {
    for await (let chunk of iterable) {
      if (mustRencode && typeof chunk === "string") {
        $debug("Re-encoding chunk to", encoding);
        chunk = Buffer.from(chunk, encoding);
      }

      const prom = writer.write(chunk);
      if (prom && $isPromise(prom)) {
        totalBytesWritten += await prom;
      } else {
        totalBytesWritten += prom;
      }
    }
  } finally {
    await writer.end();
  }

  return totalBytesWritten;
}

async function writeFileAsyncIterator(fdOrPath, iterable, optionsOrEncoding, flag, mode) {
  let encoding;
  if (typeof optionsOrEncoding === "object") {
    encoding = optionsOrEncoding?.encoding ?? (encoding || "utf8");
    flag = optionsOrEncoding?.flag ?? (flag || "w");
    mode = optionsOrEncoding?.mode ?? (mode || 0o666);
  } else if (typeof optionsOrEncoding === "string" || optionsOrEncoding == null) {
    encoding = optionsOrEncoding || "utf8";
    flag ??= "w";
    mode ??= 0o666;
  }

  if (!Buffer.isEncoding(encoding)) {
    // ERR_INVALID_OPT_VALUE_ENCODING was removed in Node v15.
    throw new TypeError(`Unknown encoding: ${encoding}`);
  }

  let mustClose = typeof fdOrPath === "string";
  if (mustClose) {
    // Rely on fs.open for further argument validaiton.
    fdOrPath = await fs.open(fdOrPath, flag, mode);
  }

  let totalBytesWritten = 0;

  try {
    totalBytesWritten = await writeFileAsyncIteratorInner(fdOrPath, iterable, encoding);
  } finally {
    if (mustClose) {
      try {
        if (typeof flag === "string" && !flag.includes("a")) {
          await fs.ftruncate(fdOrPath, totalBytesWritten);
        }
      } finally {
        await fs.close(fdOrPath);
      }
    }
  }
}
