import {
  reactive,
  readonly,
  toRaw,
  ReactiveFlags,
  Target,
  readonlyMap,
  reactiveMap,
  shallowReactiveMap,
  shallowReadonlyMap,
  isReadonly,
  isShallow
} from './reactive'
import { TrackOpTypes, TriggerOpTypes } from './operations'
import {
  track,
  trigger,
  ITERATE_KEY,
  pauseTracking,
  resetTracking
} from './effect'
import {
  isObject,
  hasOwn,
  isSymbol,
  hasChanged,
  isArray,
  isIntegerKey,
  extend,
  makeMap
} from '@vue/shared'
import { isRef } from './ref'
import { warn } from './warning'

const isNonTrackableKeys = /*#__PURE__*/ makeMap(`__proto__,__v_isRef,__isVue`)

const builtInSymbols = new Set(
  /*#__PURE__*/
  Object.getOwnPropertyNames(Symbol)
    // ios10.x Object.getOwnPropertyNames(Symbol) can enumerate 'arguments' and 'caller'
    // but accessing them on Symbol leads to TypeError because Symbol is a strict mode
    // function
    .filter(key => key !== 'arguments' && key !== 'caller')
    .map(key => (Symbol as any)[key])
    .filter(isSymbol)
)

const get = /*#__PURE__*/ createGetter()
const shallowGet = /*#__PURE__*/ createGetter(false, true)
const readonlyGet = /*#__PURE__*/ createGetter(true)
const shallowReadonlyGet = /*#__PURE__*/ createGetter(true, true)

const arrayInstrumentations = /*#__PURE__*/ createArrayInstrumentations()

function createArrayInstrumentations() {
  const instrumentations: Record<string, Function> = {}
  /*
     方法中的 第一个参数 this 入参只是作为一个形式上的参数，供 TypeScript 做静态检查时使用，编译后并不会生成实际的入参。
      而args  为啥是个数组呢，因为这三个方法都接受第二个参数，查询的起始位置，比如说a =【1,2,3,4】从 a.indexof(2,2)
      a.unshift(1); 此时为true；
  * */
  // instrument identity-sensitive Array methods to account for possible reactive
  // values
  ;(['includes', 'indexOf', 'lastIndexOf'] as const).forEach(key => {
    instrumentations[key] = function (this: unknown[], ...args: unknown[]) {
      const arr = toRaw(this) as any
      for (let i = 0, l = this.length; i < l; i++) {
        track(arr, TrackOpTypes.GET, i + '')
      }
      // we run the method using the original args first (which may be reactive)
      const res = arr[key](...args)
      if (res === -1 || res === false) {
        //这个地方为啥要在查找不到的时候再次尝试原始值呢？
        //e.g. const obj = {} ; const temp = reactive(obj); const arr = reactive([obj]);console.log(arr.includes(temp)),
        // 我们期待得到的是true对吧，但是在此行代码之前，实际执行效果却是false
        //因为arr取出每一项去和obj比较，arr此时是[obj], 而我们传入的参数temp确是obj的代理对象，肯定匹配不到，所以我们要对结果进行修正。
        // if that didn't work, run it again using raw values.
        return arr[key](...args.map(toRaw))
      } else {
        return res
      }
    }
  })
  // instrument length-altering mutation methods to avoid length being tracked
  // which leads to infinite loops in some cases (#2137)
  //这些方法为什么要函数劫持呢？因为这些方法会隐式修改数组的长度，属于数组的栈方法。
  ;(['push', 'pop', 'shift', 'unshift', 'splice'] as const).forEach(key => {
    instrumentations[key] = function (this: unknown[], ...args: unknown[]) {
      /*
      *  此处为啥先暂停呢？
      * 因为push操作会间接的读取length属性，所以我们要屏蔽对length属性的读取，从而避免它
      * 与副作用函数之间建立联系，
      * push操作本意是修改操作，而不是读取操作，所以避免建立响应联系并不会产生其他的副作用。
        其实push的内部逻辑就是
        * 1、读取数组长度 len
        * 2、读取参数长度为argCount
        * 3、对于参数遍历执行(赋值操作，并len++)
        * 4、更新数组length为len
        * 5、返回len
        * 所以我们在真正执行这些方法之前，先暂停追踪，避免对length属性跟副作用函数之间建立联系
        * 在方法执行之后，我们在重置追踪标志位为上一个状态。
*
          比如a=[],执行push 时，a.push(1);
          取push这个属性的时候本身不需要track
         那push操作进来的新值，是怎么变成响应式的呢？
        是执行了这个操作    a[0]=1;走了proxy的setter,触发了trigger
        * 先给下标赋值，然后设置length，触发了两次set。不过还有个现象是，虽然push带来的length操作会触发两次set，
        但走到 length 逻辑时，获取老的 length 也已经是新的值了，所以由于value === oldValue，实际只会走到一次trigger
      * */
      pauseTracking()
      const res = (toRaw(this) as any)[key].apply(this, args)
      resetTracking()
      return res
    }
  })
  return instrumentations
}

function createGetter(isReadonly = false, shallow = false) {
  return function get(target: Target, key: string | symbol, receiver: object) {
    if (key === ReactiveFlags.IS_REACTIVE) {
      return !isReadonly
    } else if (key === ReactiveFlags.IS_READONLY) {
      return isReadonly
    } else if (key === ReactiveFlags.IS_SHALLOW) {
      return shallow
    } else if (
      //代理对象通过属性 ReactiveFlags.RAW  获取原始数据
      key === ReactiveFlags.RAW &&
      receiver ===
        (isReadonly
          ? shallow
            ? shallowReadonlyMap
            : readonlyMap
          : shallow
          ? shallowReactiveMap
          : reactiveMap
        ).get(target)
    ) {
      return target
    }

    const targetIsArray = isArray(target)

    if (!isReadonly && targetIsArray && hasOwn(arrayInstrumentations, key)) {
      return Reflect.get(arrayInstrumentations, key, receiver)
    }

    const res = Reflect.get(target, key, receiver)
    //如果是Symbol 类型，那么就看是否是 ESM规范中带的那13个Symbol自有属性 ：是否是__proto__,__v_isRef,__isVue 这些不需要追踪的属性
    //为了避免发生意外地错误，以及性能上的考虑，不应该在副作用函数与Symbol.iterator这类symbol值之间建立响应联系，所以在追踪前进行过滤。
    if (isSymbol(key) ? builtInSymbols.has(key) : isNonTrackableKeys(key)) {
      return res
    }
    //如果是只读的响应式代理，那么就没必要与副作用函数做关联。
    if (!isReadonly) {
      track(target, TrackOpTypes.GET, key)
    }

    if (shallow) {
      return res
    }

    if (isRef(res)) {
      // ref unwrapping - skip unwrap for Array + integer key.
      //不是数组就自动展开ref isIntegerKey是判断是否是数组的String下标，因为在追踪的时候，追踪的是字符串类型的。
      //此处以前的写法很反人类
      return targetIsArray && isIntegerKey(key) ? res : res.value
    }

    if (isObject(res)) {
      // Convert returned value into a proxy as well. we do the isObject check
      // here to avoid invalid value warning. Also need to lazy access readonly
      // and reactive here to avoid circular dependency.
      //reactive的深度readonly或者reactive，在你读取的时候根据设置，对返回值进行包装并返回
      return isReadonly ? readonly(res) : reactive(res)
    }

    return res
  }
}

const set = /*#__PURE__*/ createSetter()
const shallowSet = /*#__PURE__*/ createSetter(true)

function createSetter(shallow = false) {
  return function set(
    target: object,
    key: string | symbol,
    value: unknown,
    receiver: object
  ): boolean {
    let oldValue = (target as any)[key]
    if (isReadonly(oldValue) && isRef(oldValue) && !isRef(value)) {
      return false
    }
    if (!shallow) {
      // 如果value是一个响应式数据，并且在深层监听模式下，那么就先求出value的真实值，避免数据污染
      if (!isShallow(value) && !isReadonly(value)) {
        oldValue = toRaw(oldValue)
        value = toRaw(value)
      }
      //对象不是数组 ，并且旧值是Ref儿新值不是Ref，让新值赋值给ref.value，ref决定trigger
      if (!isArray(target) && isRef(oldValue) && !isRef(value)) {
        oldValue.value = value
        return true
      }
    } else {
      // in shallow mode, objects are set as-is regardless of reactive or not
    }

    const hadKey =
      isArray(target) && isIntegerKey(key)
        ? Number(key) < target.length
        : hasOwn(target, key)
    //赋值操作
    const result = Reflect.set(target, key, value, receiver)
    // 如果是原始数据原型链上的数据操作，不做任何触发监听函数的行为。
    // don't trigger if target is something up in the prototype chain of original
    if (target === toRaw(receiver)) {
      if (!hadKey) {
        trigger(target, TriggerOpTypes.ADD, key, value)
        //数组的push操作并不会触发两次trigger的原因在此，先下标赋值·，然后length设置的时候，
        // 此时数组的length 已经改变成新的长度（数据修改之后的数组的长度），故相等，不会触发两次trigger
      } else if (hasChanged(value, oldValue)) {
        trigger(target, TriggerOpTypes.SET, key, value, oldValue)
      }
    }
    return result
  }
}

function deleteProperty(target: object, key: string | symbol): boolean {
  const hadKey = hasOwn(target, key)
  const oldValue = (target as any)[key]
  const result = Reflect.deleteProperty(target, key)
  if (result && hadKey) {
    trigger(target, TriggerOpTypes.DELETE, key, undefined, oldValue)
  }
  return result
}

function has(target: object, key: string | symbol): boolean {
  const result = Reflect.has(target, key)
  if (!isSymbol(key) || !builtInSymbols.has(key)) {
    track(target, TrackOpTypes.HAS, key)
  }
  return result
}

function ownKeys(target: object): (string | symbol)[] {
  track(target, TrackOpTypes.ITERATE, isArray(target) ? 'length' : ITERATE_KEY)
  return Reflect.ownKeys(target)
}

export const mutableHandlers: ProxyHandler<object> = {
  get,
  set,
  deleteProperty,
  has,
  ownKeys
}

export const readonlyHandlers: ProxyHandler<object> = {
  get: readonlyGet,
  set(target, key) {
    if (__DEV__) {
      warn(
        `Set operation on key "${String(key)}" failed: target is readonly.`,
        target
      )
    }
    return true
  },
  deleteProperty(target, key) {
    if (__DEV__) {
      warn(
        `Delete operation on key "${String(key)}" failed: target is readonly.`,
        target
      )
    }
    return true
  }
}

export const shallowReactiveHandlers = /*#__PURE__*/ extend(
  {},
  mutableHandlers,
  {
    get: shallowGet,
    set: shallowSet
  }
)

// Props handlers are special in the sense that it should not unwrap top-level
// refs (in order to allow refs to be explicitly passed down), but should
// retain the reactivity of the normal readonly object.
export const shallowReadonlyHandlers = /*#__PURE__*/ extend(
  {},
  readonlyHandlers,
  {
    get: shallowReadonlyGet
  }
)
