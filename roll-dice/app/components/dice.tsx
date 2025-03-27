"use client"
import { cn } from "@/lib/utils"

interface DiceProps {
  value: number
  isRolling: boolean
  onClick: () => void
}

export default function Dice({ value, isRolling, onClick }: DiceProps) {
  // Ensure value is between 1 and 6
  const safeValue = Math.min(Math.max(1, value), 6)

  return (
    <div
      className={cn(
        "relative w-24 h-24 bg-white rounded-xl shadow-lg cursor-pointer flex items-center justify-center transition-all duration-100",
        isRolling && "animate-bounce",
      )}
      onClick={onClick}
    >
      <div className={cn("dice-face", isRolling && "blur-sm")}>
        {safeValue === 1 && (
          <div className="grid place-items-center h-full w-full p-2">
            <div className="w-5 h-5 bg-black rounded-full" />
          </div>
        )}

        {safeValue === 2 && (
          <div className="grid grid-cols-2 h-full w-full p-5 gap-1">
            <div className="flex justify-start items-start pl-3">
              <div className="w-3 h-3 bg-black rounded-full" />
            </div>
            <div className="flex justify-end items-end pr-3 pb-1">
              <div className="w-3 h-3 bg-black rounded-full" />
            </div>
          </div>
        )}

        {safeValue === 3 && (
          <div className="grid grid-cols-3 grid-rows-3 h-full w-full p-5 gap-1">
            <div className="col-start-1 row-start-1 flex justify-start items-start pl-1 pt-1">
              <div className="w-3 h-3 bg-black rounded-full" />
            </div>
            <div className="col-start-2 row-start-2 flex justify-center items-center">
              <div className="w-3 h-3 bg-black rounded-full" />
            </div>
            <div className="col-start-3 row-start-3 flex justify-end items-end pr-1 pb-1">
              <div className="w-3 h-3 bg-black rounded-full" />
            </div>
          </div>
        )}

        {safeValue === 4 && (
          <div className="grid grid-cols-2 grid-rows-2 h-full w-full p-5 gap-1">
            <div className="flex justify-start items-start pl-1">
              <div className="w-3 h-3 bg-black rounded-full" />
            </div>
            <div className="flex justify-end items-start pr-1">
              <div className="w-3 h-3 bg-black rounded-full" />
            </div>
            <div className="flex justify-start items-end pl-1">
              <div className="w-3 h-3 bg-black rounded-full" />
            </div>
            <div className="flex justify-end items-end pr-1">
              <div className="w-3 h-3 bg-black rounded-full" />
            </div>
          </div>
        )}

        {safeValue === 5 && (
          <div className="grid grid-cols-3 grid-rows-3 h-full w-full p-5 gap-1">
            <div className="col-start-1 row-start-1 flex justify-start items-start pl-1 pt-1">
              <div className="w-3 h-3 bg-black rounded-full" />
            </div>
            <div className="col-start-3 row-start-1 flex justify-end items-start pr-1 pt-1">
              <div className="w-3 h-3 bg-black rounded-full" />
            </div>
            <div className="col-start-2 row-start-2 flex justify-center items-center">
              <div className="w-3 h-3 bg-black rounded-full" />
            </div>
            <div className="col-start-1 row-start-3 flex justify-start items-end pl-1 pb-1">
              <div className="w-3 h-3 bg-black rounded-full" />
            </div>
            <div className="col-start-3 row-start-3 flex justify-end items-end pr-1 pb-1">
              <div className="w-3 h-3 bg-black rounded-full" />
            </div>
          </div>
        )}

        {safeValue === 6 && (
          <div className="grid grid-cols-2 grid-rows-3 h-full w-full p-5 gap-1">
            <div className="flex justify-start items-start pl-1">
              <div className="w-3 h-3 bg-black rounded-full" />
            </div>
            <div className="flex justify-end items-start pr-1">
              <div className="w-3 h-3 bg-black rounded-full" />
            </div>
            <div className="flex justify-start items-center pl-1">
              <div className="w-3 h-3 bg-black rounded-full" />
            </div>
            <div className="flex justify-end items-center pr-1">
              <div className="w-3 h-3 bg-black rounded-full" />
            </div>
            <div className="flex justify-start items-end pl-1">
              <div className="w-3 h-3 bg-black rounded-full" />
            </div>
            <div className="flex justify-end items-end pr-1">
              <div className="w-3 h-3 bg-black rounded-full" />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

