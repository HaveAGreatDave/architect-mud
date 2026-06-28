// Undo/redo command stack for VINE editor.
// Commands are plain objects: { undo() } — the "do" is always performed by the
// caller before pushing so CommandStack only needs to reverse it.
class VineCommandStack {
  constructor(maxSize = 100) {
    this._stack = [];
    this._index = -1;
    this._max = maxSize;
  }

  // Push a command that has already been executed. Clears any redo history.
  push(cmd) {
    this._stack = this._stack.slice(0, this._index + 1);
    this._stack.push(cmd);
    if (this._stack.length > this._max) { this._stack.shift(); }
    else { this._index++; }
  }

  undo() {
    if (this._index < 0) return false;
    this._stack[this._index--].undo();
    return true;
  }

  redo() {
    if (this._index >= this._stack.length - 1) return false;
    const cmd = this._stack[++this._index];
    if (cmd.redo) cmd.redo();
    return true;
  }

  clear() { this._stack = []; this._index = -1; }
}

window.VineCommandStack = VineCommandStack;
