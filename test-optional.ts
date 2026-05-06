import { Type, type TObject } from "typebox";

const OptObj = Type.Optional(Type.Object({ a: Type.String() }));

type Test = typeof OptObj extends TObject ? true : false;

const schema = Type.Object({
  pricing: Type.Optional(Type.Object({ total: Type.Number() })),
});

type P = typeof schema["properties"]["pricing"] extends TObject ? true : false;

const _test: P = true;
