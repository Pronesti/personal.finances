<?php

namespace Database\Factories;

use App\Models\Ledger;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Ledger>
 */
class LedgerFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'owner_user_id' => User::factory(),
        ];
    }
}
