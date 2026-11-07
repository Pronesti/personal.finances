<?php

namespace Database\Factories;

use App\Models\Ledger;
use Illuminate\Database\Eloquent\Factories\Factory;

class AccountFactory extends Factory
{
    public function definition(): array
    {
        return ['ledger_id' => Ledger::factory(), 'id' => 'expense:'.fake()->uuid(), 'parent_id' => null, 'type' => 'expense', 'custom_name' => 'Synthetic expense', 'label_key' => null, 'posting' => true, 'enabled' => true, 'currency' => 'ARS'];
    }
}
