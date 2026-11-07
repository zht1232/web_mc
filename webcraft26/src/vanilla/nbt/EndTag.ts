// Port of net.minecraft.nbt.EndTag. Singleton: id 0, empty payload.
import { Tag, type DataInput, type DataOutput, type TagVisitor } from './Tag.js';
import { registerTagType, TAG_END, type TagType } from './TagTypes.js';

export class EndTag extends Tag {
  static readonly INSTANCE = new EndTag();
  private constructor() { super(); }

  getId(): number { return TAG_END; }
  getType(): TagType { return EndTag.TYPE; }
  write(_out: DataOutput): void { /* no payload */ }
  copy(): EndTag { return this; }
  equals(other: Tag): boolean { return other instanceof EndTag; }
  accept(visitor: TagVisitor): void { visitor.visitEnd(this); }

  static readonly TYPE: TagType<EndTag> = {
    id: TAG_END,
    load(_input: DataInput): EndTag { return EndTag.INSTANCE; },
    skip(_input: DataInput): void { /* no payload */ },
    getName: () => 'END',
    getPrettyName: () => 'TAG_End',
  };

  static valueOf(): EndTag { return EndTag.INSTANCE; }
}

registerTagType(EndTag.TYPE);
