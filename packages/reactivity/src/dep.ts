import { ReactiveEffect, trackOpBit } from './effect'

export type Dep = Set<ReactiveEffect> & TrackedMarkers

/**
 * wasTracked and newTracked maintain the status for several levels of effect
 * tracking recursion. One bit per level is used to define whether the dependency
 * was/is tracked.
 * 为什么要用位运算呢？用数组存储不行么？
 * 因为每个页面可能有大量的副作用函数，层级嵌套极其复杂，都需要频繁的进行标记，
 * 这个开销是非常大的，因此使用了运算符，提升了标记的速度，也节省了运行内存。
 */
type TrackedMarkers = {
  /**
   * wasTracked
   * 副作用函数执行前被收集过
   */
  w: number
  /**
   * 副作用函数执行后被收集过
   * newTracked
   */
  n: number
}

//创建一个订阅者集合；这个集合用于某个依赖项，比如，ref  ref(1).deps = createDep() 每个依赖项身上挂着很多effects，即有很多订阅者（副作用函数）
export const createDep = (effects?: ReactiveEffect[]): Dep => {
  const dep = new Set<ReactiveEffect>(effects) as Dep
  dep.w = 0
  dep.n = 0
  return dep
}
//判断在当前深度 是否被收集过（执行副作用函数之前）
export const wasTracked = (dep: Dep): boolean => (dep.w & trackOpBit) > 0
//在当前深度下，判断依赖项是否在副作用函数执行后被收集
export const newTracked = (dep: Dep): boolean => (dep.n & trackOpBit) > 0

// 传入进来的是{deps:deps} 是一个ReactiveEffect 副作用函数，内部的deps是他的所有依赖项的订阅集合【dep,dep,dep<set>】
// 此处遍历副作用函数的依赖项deps，并给没一个依赖项打上标记，标识依赖在哪一层被收集过
export const initDepMarkers = ({ deps }: ReactiveEffect) => {
  if (deps.length) {
    for (let i = 0; i < deps.length; i++) {
      //  给当前的依赖项打上标记，标识依赖在副作用函数执行前已被收集，增加在哪一层被收集过
      //这deps[i] 是对象的某个key对应的副作用对象集合，或者是ref,computed,watch等响应式变量对应的依赖（副作用）集合，他们都有dep对象
      // 所以我们单独对dep进行标记，其他各个响应式项均可自动复用
      deps[i].w |= trackOpBit // set was tracked
    }
  }
}
//对失效依赖进行删除
export const finalizeDepMarkers = (effect: ReactiveEffect) => {
  const { deps } = effect
  if (deps.length) {
    let ptr = 0
    for (let i = 0; i < deps.length; i++) {
      const dep = deps[i]
      //  曾经收集过，但重新收集依赖时并没有收集，需要删除依赖
      //text = obj.a?obj.text:'我不依赖状态，就不需要收集obj.text了'
      if (wasTracked(dep) && !newTracked(dep)) {
        dep.delete(effect)
      } else {
        //这种写法好贱啊，这是在原数组上直接进行了赋值，只关心需要保留的项，然后依顺序赋值
        //最后用deps.length 直接去除后面不需要的数组项
        deps[ptr++] = dep
      }
      // clear bits
      // 清理 was 和 new 标记，将它们对应深度的 bit，置为 0
      dep.w &= ~trackOpBit
      dep.n &= ~trackOpBit
    }
    deps.length = ptr
  }
}
