import { expect, it, vi } from "vitest";
import { loginCooldown, loginWithCooldown, waitForLoginRetry } from "../src/services/login.js";
it('respects hour-long limits without the former five-minute cap',()=>{
 expect(loginCooldown({name:'RateLimitError',timeToReset:3600000},1)).toBe(3602000);
 expect(loginCooldown({status:429,retry_after:120},1)).toBe(122000);
 expect(loginCooldown({status:429,rawError:{retry_after:0.5}},1)).toBe(20000);
 expect(loginCooldown({status:401},1)).toBeNull();
 expect(loginCooldown({status:429},2)).toBe(122000);
});
it('counts down locally without making API requests',async()=>{
 let now=0;const report=vi.fn();await waitForLoginRetry(120000,new AbortController().signal,report,()=>now,async ms=>{now+=ms;});
 expect(report.mock.calls).toEqual([[120],[60]]);
});
it('cancels a long cooldown immediately on shutdown',async()=>{
 const controller=new AbortController();const promise=waitForLoginRetry(Date.now()+3600000,controller.signal,()=>{});controller.abort();await promise;
});
it('retries after cooldown and clears saved deadline only on success',async()=>{
 vi.useFakeTimers();
 try{
 const login=vi.fn().mockRejectedValueOnce({status:429,retry_after:120}).mockResolvedValue(undefined);const save=vi.fn();
 const task=loginWithCooldown({login,signal:new AbortController().signal,readDeadline:()=>0,saveDeadline:save});
 await vi.advanceTimersByTimeAsync(121999);expect(login).toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(1);await task;expect(login).toHaveBeenCalledTimes(2);expect(save).toHaveBeenLastCalledWith(0);
 }finally{vi.useRealTimers();}
});
it('honors a persisted deadline after restart',async()=>{
 vi.useFakeTimers();
 try{const login=vi.fn().mockResolvedValue(undefined);const task=loginWithCooldown({login,signal:new AbortController().signal,readDeadline:()=>Date.now()+120000,saveDeadline:()=>{}});
 await vi.advanceTimersByTimeAsync(119999);expect(login).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(1);await task;expect(login).toHaveBeenCalledOnce();
 }finally{vi.useRealTimers();}
});
